import type { Employee, GeneratedAsset, UploadedAssetRecord, WorkspaceTask } from "./types.js";

export const taskTypes = ["Amazon 六图套图", "Amazon 白底主图", "场景图"] as const;

export function isTaskType(value: unknown): value is WorkspaceTask["type"] {
  return typeof value === "string" && taskTypes.includes(value as (typeof taskTypes)[number]);
}

export function taskSubmissionError(task: WorkspaceTask, employee: Pick<Employee, "id" | "role">) {
  if (task.status === "待审核") return "该任务已提交审核，请等待审核结果";
  if (task.status === "已通过") return "已通过的任务不能直接覆盖，请新建修改任务";
  if (employee.role === "设计" && !task.assignedToId) return "任务尚未分配负责人，请联系运营或管理员";
  if (employee.role === "设计" && task.assignedToId !== employee.id) {
    return "该任务分配给了其他设计人员，不能代为提交";
  }
  return undefined;
}

export function expectedTaskInputCount(type: WorkspaceTask["type"]) {
  return type === "Amazon 六图套图" ? 3 : 1;
}

export function taskCreationInputError(type: WorkspaceTask["type"], inputCount: number) {
  const expected = expectedTaskInputCount(type);
  if (inputCount <= 0) return "请至少上传 1 张商品原图";
  if (inputCount < expected) {
    return `${type} 至少需要 ${expected} 张商品原图作为参考，当前只有 ${inputCount} 张`;
  }
  return undefined;
}

export function expectedTaskOutputCount(type: WorkspaceTask["type"]) {
  return type === "Amazon 六图套图" ? 6 : 1;
}

export function taskOutputSubmissionError(task: WorkspaceTask, outputCount: number) {
  const expected = expectedTaskOutputCount(task.type);
  if (outputCount <= 0) return "请至少提交 1 张成品图";
  if (outputCount < expected) {
    return `${task.type} 至少需要提交 ${expected} 张成品图，当前只有 ${outputCount} 张`;
  }
  return undefined;
}

export function taskOutputCount(task: Pick<WorkspaceTask, "outputAssetIds" | "outputCount">) {
  return Math.max(task.outputCount ?? 0, task.outputAssetIds?.length ?? 0);
}

export function taskReviewApprovalError(task: WorkspaceTask) {
  const outputError = taskOutputSubmissionError(task, taskOutputCount(task));
  return outputError ? `不能通过审核：${outputError}` : undefined;
}

export function taskOutputAssetIntegrityError(
  task: WorkspaceTask,
  uploadedAssets: Pick<UploadedAssetRecord, "id" | "taskId" | "productId" | "purpose">[],
  generatedAssets: Pick<GeneratedAsset, "id">[],
) {
  const outputAssetIds = [...new Set(task.outputAssetIds ?? [])];
  const expected = expectedTaskOutputCount(task.type);
  if (outputAssetIds.length < expected) {
    return `${task.type} 需要 ${expected} 张可追溯成品图，当前只关联 ${outputAssetIds.length} 张`;
  }

  const invalidAssetId = outputAssetIds.find((id) => {
    const uploaded = uploadedAssets.find((asset) => asset.id === id);
    if (uploaded) {
      return uploaded.taskId !== task.id
        || uploaded.productId !== task.productId
        || uploaded.purpose !== "output";
    }
    return !generatedAssets.some((asset) => asset.id === id);
  });

  return invalidAssetId
    ? `成品图 ${invalidAssetId} 不存在或不属于当前任务，请让设计重新提交`
    : undefined;
}

export function reviewRejectionCommentError(comment: string) {
  const normalized = comment.trim().replace(/\s+/g, " ");
  if (!normalized) return "驳回时必须填写修改意见";

  const meaningful = normalized.replace(/[，。,.!！?？、；;：:\s]/g, "");
  if (/^(不行|不通过|不合格|不好看|重做|修改|修改一下|改一下|重新做|再改改|有问题|不对)$/i.test(meaningful)) {
    return "驳回意见过于笼统，请写清具体问题和修改方向";
  }
  if (meaningful.length < 8) {
    return "驳回意见请至少写清 8 个字以上的具体问题和修改要求";
  }
  return undefined;
}
