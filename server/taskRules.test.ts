import { describe, expect, it } from "vitest";
import {
  expectedTaskInputCount,
  expectedTaskOutputCount,
  isTaskType,
  reviewRejectionCommentError,
  taskCreationInputError,
  taskOutputAssetIntegrityError,
  taskOutputSubmissionError,
  taskReviewApprovalError,
  taskSubmissionError,
} from "./taskRules.js";
import type { WorkspaceTask } from "./types.js";

const task = (overrides: Partial<WorkspaceTask> = {}): WorkspaceTask => ({
  id: "TSK-12345678",
  productId: "product-1",
  sku: "HC-001",
  productName: "Wall Art",
  type: "Amazon 六图套图",
  status: "待生成",
  progress: 0,
  owner: "林晓",
  assignedToId: "designer-1",
  assignedToName: "林晓",
  updatedAt: "2026-07-02T00:00:00.000Z",
  ...overrides,
});

describe("task workflow rules", () => {
  it("only accepts supported production task types", () => {
    expect(isTaskType("Amazon 六图套图")).toBe(true);
    expect(isTaskType("直接通过审核")).toBe(false);
  });

  it("prevents unassigned, cross-assignee and already-reviewed submissions", () => {
    expect(taskSubmissionError(task({ assignedToId: undefined }), { id: "designer-1", role: "设计" }))
      .toMatch(/尚未分配/);
    expect(taskSubmissionError(task(), { id: "designer-2", role: "设计" }))
      .toMatch(/其他设计人员/);
    expect(taskSubmissionError(task({ status: "待审核" }), { id: "designer-1", role: "设计" }))
      .toMatch(/等待审核/);
    expect(taskSubmissionError(task({ status: "已通过" }), { id: "admin", role: "管理员" }))
      .toMatch(/不能直接覆盖/);
    expect(taskSubmissionError(task({ status: "已驳回" }), { id: "designer-1", role: "设计" }))
      .toBeUndefined();
  });

  it("requires enough source images when creating production tasks", () => {
    expect(expectedTaskInputCount("Amazon 六图套图")).toBe(3);
    expect(expectedTaskInputCount("场景图")).toBe(1);
    expect(taskCreationInputError("Amazon 六图套图", 0)).toBe("请至少上传 1 张商品原图");
    expect(taskCreationInputError("Amazon 六图套图", 2))
      .toBe("Amazon 六图套图 至少需要 3 张商品原图作为参考，当前只有 2 张");
    expect(taskCreationInputError("Amazon 六图套图", 3)).toBeUndefined();
    expect(taskCreationInputError("场景图", 1)).toBeUndefined();
  });

  it("requires enough output images for each task type", () => {
    expect(expectedTaskOutputCount("Amazon 六图套图")).toBe(6);
    expect(expectedTaskOutputCount("Amazon 白底主图")).toBe(1);
    expect(taskOutputSubmissionError(task({ type: "Amazon 六图套图" }), 0)).toBe("请至少提交 1 张成品图");
    expect(taskOutputSubmissionError(task({ type: "Amazon 六图套图" }), 5))
      .toBe("Amazon 六图套图 至少需要提交 6 张成品图，当前只有 5 张");
    expect(taskOutputSubmissionError(task({ type: "Amazon 六图套图" }), 6)).toBeUndefined();
    expect(taskOutputSubmissionError(task({ type: "Amazon 白底主图" }), 1)).toBeUndefined();
  });

  it("blocks review approval when pending output delivery is incomplete", () => {
    expect(taskReviewApprovalError(task({
      status: "待审核",
      type: "Amazon 六图套图",
      outputCount: 5,
      outputAssetIds: ["a1", "a2", "a3", "a4", "a5"],
    }))).toBe("不能通过审核：Amazon 六图套图 至少需要提交 6 张成品图，当前只有 5 张");

    expect(taskReviewApprovalError(task({
      status: "待审核",
      type: "Amazon 六图套图",
      outputCount: 6,
      outputAssetIds: ["a1", "a2", "a3", "a4", "a5", "a6"],
    }))).toBeUndefined();
  });

  it("requires approved outputs to point to traceable assets", () => {
    const pending = task({
      status: "待审核",
      type: "Amazon 白底主图",
      outputCount: 1,
      outputAssetIds: ["missing-output"],
    });

    expect(taskOutputAssetIntegrityError(pending, [], []))
      .toBe("成品图 missing-output 不存在或不属于当前任务，请让设计重新提交");
    expect(taskOutputAssetIntegrityError(
      pending,
      [{ id: "missing-output", taskId: "other-task", productId: "product-1", purpose: "output" }],
      [],
    )).toBe("成品图 missing-output 不存在或不属于当前任务，请让设计重新提交");
    expect(taskOutputAssetIntegrityError(
      pending,
      [{ id: "missing-output", taskId: "TSK-12345678", productId: "product-1", purpose: "output" }],
      [],
    )).toBeUndefined();
    expect(taskOutputAssetIntegrityError(
      { ...pending, outputAssetIds: ["generated-output"] },
      [],
      [{ id: "generated-output" }],
    )).toBeUndefined();
  });

  it("does not trust outputCount when output asset ids are missing", () => {
    expect(taskOutputAssetIntegrityError(
      task({
        status: "待审核",
        type: "Amazon 六图套图",
        outputCount: 6,
        outputAssetIds: ["a1", "a2"],
      }),
      [],
      [{ id: "a1" }, { id: "a2" }],
    )).toBe("Amazon 六图套图 需要 6 张可追溯成品图，当前只关联 2 张");
  });

  it("requires actionable rejection comments for designers", () => {
    expect(reviewRejectionCommentError("")).toBe("驳回时必须填写修改意见");
    expect(reviewRejectionCommentError("改一下")).toBe("驳回意见过于笼统，请写清具体问题和修改方向");
    expect(reviewRejectionCommentError("主图太暗")).toBe("驳回意见请至少写清 8 个字以上的具体问题和修改要求");
    expect(reviewRejectionCommentError("主图背景不够纯白，请改成纯白背景并保持主体居中")).toBeUndefined();
  });
});
