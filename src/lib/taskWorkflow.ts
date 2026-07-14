import type { EmployeeAccount, GenerationTask } from "../types/domain";

export interface TaskNextAction {
  tone: "neutral" | "work" | "waiting" | "danger" | "done";
  title: string;
  description: string;
}

export function isWorkflowTaskOverdue(task: Pick<GenerationTask, "dueAt" | "status">, now = new Date()) {
  return Boolean(
    task.dueAt
    && task.status !== "已通过"
    && new Date(task.dueAt).getTime() < now.getTime(),
  );
}

export function expectedTaskOutputCount(type: GenerationTask["type"]) {
  return type === "Amazon 六图套图" ? 6 : 1;
}

export function expectedTaskInputCount(type: GenerationTask["type"]) {
  return type === "Amazon 六图套图" ? 3 : 1;
}

export function taskInputCreationMessage(type: GenerationTask["type"], selectedCount: number) {
  const expected = expectedTaskInputCount(type);
  if (selectedCount <= 0) {
    return {
      ready: false,
      title: `至少需要 ${expected} 张商品原图`,
      description: type === "Amazon 六图套图"
        ? "六图套图建议提供多个角度，避免美工反复追问细节。"
        : "请先上传商品原图，再创建任务。",
    };
  }
  if (selectedCount < expected) {
    return {
      ready: false,
      title: `原图还差 ${expected - selectedCount} 张`,
      description: `${type} 至少需要 ${expected} 张商品原图，当前选择 ${selectedCount} 张。`,
    };
  }
  return {
    ready: true,
    title: "原图数量满足创建要求",
    description: `已选择 ${selectedCount} 张，可创建任务。`,
  };
}

export function taskOutputSubmissionMessage(type: GenerationTask["type"], selectedCount: number) {
  const expected = expectedTaskOutputCount(type);
  if (selectedCount <= 0) {
    return {
      ready: false,
      title: `至少需要 ${expected} 张成品`,
      description: type === "Amazon 六图套图"
        ? "六图套图建议一次性提交主图、角度、卖点、尺寸、场景和细节图。"
        : "请选择成品图后再提交审核。",
    };
  }
  if (selectedCount < expected) {
    return {
      ready: false,
      title: `还差 ${expected - selectedCount} 张`,
      description: `${type} 至少需要 ${expected} 张成品，当前选择 ${selectedCount} 张。`,
    };
  }
  return {
    ready: true,
    title: "成品数量满足提交要求",
    description: `已选择 ${selectedCount} 张，可提交审核。`,
  };
}

export function reviewRejectionCommentMessage(comment: string) {
  const normalized = comment.trim().replace(/\s+/g, " ");
  if (!normalized) {
    return {
      ready: false,
      title: "驳回需要填写修改意见",
      description: "请写清具体问题和修改方向，设计才能直接处理。",
    };
  }

  const meaningful = normalized.replace(/[，。,.!！?？、；;：:\s]/g, "");
  if (/^(不行|不通过|不合格|不好看|重做|修改|修改一下|改一下|重新做|再改改|有问题|不对)$/i.test(meaningful)) {
    return {
      ready: false,
      title: "意见过于笼统",
      description: "请说明哪张图、哪个位置、要改成什么效果。",
    };
  }
  if (meaningful.length < 8) {
    return {
      ready: false,
      title: "意见还不够具体",
      description: "建议至少写清 8 个字以上的问题和修改要求。",
    };
  }
  return {
    ready: true,
    title: "驳回意见可执行",
    description: "设计可以根据这条意见修改并重新提交。",
  };
}

export function taskWorkflowStage(task: GenerationTask) {
  const submittedVersion = task.version ? `V${task.version}` : "当前版本";
  switch (task.status) {
    case "草稿":
      return { step: 1, title: "草稿准备", description: "补齐商品原图和任务资料后进入生产。" };
    case "待生成":
      return { step: 2, title: "等待设计制作", description: task.assignedToName ? `负责人：${task.assignedToName}` : "还没有分配设计负责人。" };
    case "生成中":
      return { step: 3, title: "设计制作中", description: `当前进度 ${task.progress}%` };
    case "待审核":
      return { step: 4, title: "等待审核", description: `${submittedVersion} 已提交，审核通过后进入交付。` };
    case "已驳回":
      return { step: 5, title: "需要修改", description: task.reviewComment || "请按审核意见修改后重新提交。" };
    case "已通过":
      return { step: 6, title: "已交付", description: `${submittedVersion} 已通过审核，可进入 Listing 或素材复用。` };
    default:
      return { step: 0, title: "未知状态", description: "请刷新任务数据。" };
  }
}

export function nextTaskAction(
  task: GenerationTask,
  user: Pick<EmployeeAccount, "id" | "role">,
  now = new Date(),
): TaskNextAction {
  const overdue = isWorkflowTaskOverdue(task, now);
  const isOwner = Boolean(task.assignedToId && task.assignedToId === user.id);
  const canDispatch = user.role === "管理员" || user.role === "运营";
  const canDesign = user.role === "管理员" || user.role === "设计";
  const canReview = user.role === "管理员" || user.role === "审核";

  if (overdue && task.status !== "待审核") {
    return {
      tone: "danger",
      title: "已逾期，需要重新安排",
      description: canDispatch ? "请调整负责人或截止时间，并同步设计处理。" : "请联系运营确认新的交付安排。",
    };
  }

  if (!task.assignedToId && task.status !== "已通过") {
    return {
      tone: canDispatch ? "work" : "waiting",
      title: canDispatch ? "下一步：分配设计负责人" : "等待运营分配负责人",
      description: canDispatch ? "选择设计人员和截止日期后，任务会进入可执行状态。" : "任务尚未分配，暂时不能提交成品。",
    };
  }

  if (task.status === "待生成" || task.status === "生成中") {
    if (canDesign && (user.role === "管理员" || isOwner)) {
      return {
        tone: "work",
        title: "下一步：上传成品并提交审核",
        description: "完成设计后上传成品图，系统会自动流转到审核中心。",
      };
    }
    return {
      tone: "waiting",
      title: "等待设计提交成品",
      description: `${task.assignedToName || "负责人"} 正在处理，运营可在必要时调整排期。`,
    };
  }

  if (task.status === "待审核") {
    return {
      tone: canReview ? "work" : "waiting",
      title: canReview ? "下一步：审核成品" : "等待审核确认",
      description: canReview ? "检查图片是否符合商品与 Amazon 视觉要求，通过或驳回修改。" : "审核通过后才会进入可交付状态。",
    };
  }

  if (task.status === "已驳回") {
    if (canDesign && (user.role === "管理员" || isOwner)) {
      return {
        tone: "danger",
        title: "下一步：按意见修改并重提",
        description: task.reviewComment || "请查看审核意见，上传新版本后再次提交审核。",
      };
    }
    return {
      tone: "waiting",
      title: "等待设计修改重提",
      description: task.reviewComment || "设计修改后会重新进入审核中心。",
    };
  }

  if (task.status === "已通过") {
    return {
      tone: "done",
      title: "任务已完成",
      description: "成品已通过审核，可在素材库复用，运营可继续完善 Listing。",
    };
  }

  return {
    tone: "neutral",
    title: "等待下一步",
    description: "请根据任务状态继续处理。",
  };
}
