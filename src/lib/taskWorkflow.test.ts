import { describe, expect, it } from "vitest";
import type { GenerationTask } from "../types/domain";
import {
  expectedTaskInputCount,
  expectedTaskOutputCount,
  isWorkflowTaskOverdue,
  nextTaskAction,
  reviewRejectionCommentMessage,
  taskInputCreationMessage,
  taskOutputSubmissionMessage,
  taskWorkflowStage,
} from "./taskWorkflow";

const task = (overrides: Partial<GenerationTask> = {}): GenerationTask => ({
  id: "TSK-12345678",
  productId: "prd-1",
  sku: "HC-001",
  productName: "Wall Art",
  type: "Amazon 六图套图",
  status: "待生成",
  progress: 0,
  owner: "林晓",
  assignedToId: "designer-1",
  assignedToName: "林晓",
  updatedAt: "刚刚",
  inputCount: 3,
  ...overrides,
});

describe("task workflow helpers", () => {
  it("detects overdue unfinished tasks", () => {
    const now = new Date("2026-07-06T12:00:00.000Z");
    expect(isWorkflowTaskOverdue(task({ dueAt: "2026-07-05T18:00:00.000Z" }), now)).toBe(true);
    expect(isWorkflowTaskOverdue(task({ status: "已通过", dueAt: "2026-07-05T18:00:00.000Z" }), now)).toBe(false);
  });

  it("explains the current workflow stage", () => {
    expect(taskWorkflowStage(task({ status: "待审核", version: 2 })).title).toBe("等待审核");
    expect(taskWorkflowStage(task({ status: "已通过", version: 3 })).description).toContain("V3");
  });

  it("tells operators to assign unowned tasks", () => {
    const action = nextTaskAction(
      task({ assignedToId: undefined, assignedToName: "待分配" }),
      { id: "ops-1", role: "运营" },
    );

    expect(action.tone).toBe("work");
    expect(action.title).toContain("分配设计负责人");
  });

  it("explains output image requirements by task type", () => {
    expect(expectedTaskOutputCount("Amazon 六图套图")).toBe(6);
    expect(expectedTaskOutputCount("场景图")).toBe(1);

    expect(taskOutputSubmissionMessage("Amazon 六图套图", 5)).toMatchObject({
      ready: false,
      title: "还差 1 张",
    });
    expect(taskOutputSubmissionMessage("Amazon 六图套图", 6)).toMatchObject({
      ready: true,
      title: "成品数量满足提交要求",
    });
  });

  it("explains source image requirements by task type", () => {
    expect(expectedTaskInputCount("Amazon 六图套图")).toBe(3);
    expect(expectedTaskInputCount("Amazon 白底主图")).toBe(1);

    expect(taskInputCreationMessage("Amazon 六图套图", 2)).toMatchObject({
      ready: false,
      title: "原图还差 1 张",
    });
    expect(taskInputCreationMessage("Amazon 六图套图", 3)).toMatchObject({
      ready: true,
      title: "原图数量满足创建要求",
    });
  });

  it("guides reviewers to write actionable rejection comments", () => {
    expect(reviewRejectionCommentMessage("").title).toBe("驳回需要填写修改意见");
    expect(reviewRejectionCommentMessage("改一下").title).toBe("意见过于笼统");
    expect(reviewRejectionCommentMessage("主图太暗").title).toBe("意见还不够具体");
    expect(reviewRejectionCommentMessage("主图背景不够纯白，请改成纯白背景并保持主体居中")).toMatchObject({
      ready: true,
      title: "驳回意见可执行",
    });
  });

  it("tells the assigned designer to submit outputs", () => {
    const action = nextTaskAction(task(), { id: "designer-1", role: "设计" });

    expect(action.tone).toBe("work");
    expect(action.title).toContain("上传成品");
  });

  it("routes pending reviews to reviewers", () => {
    const reviewerAction = nextTaskAction(task({ status: "待审核" }), { id: "reviewer-1", role: "审核" });
    const designerAction = nextTaskAction(task({ status: "待审核" }), { id: "designer-1", role: "设计" });

    expect(reviewerAction.title).toContain("审核成品");
    expect(designerAction.tone).toBe("waiting");
  });

  it("routes rejected tasks back to the assigned designer", () => {
    const action = nextTaskAction(
      task({ status: "已驳回", reviewComment: "主图背景不够纯白" }),
      { id: "designer-1", role: "设计" },
    );

    expect(action.tone).toBe("danger");
    expect(action.description).toContain("主图背景");
  });
});
