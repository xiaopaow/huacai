import { describe, expect, it } from "vitest";
import type { WorkspaceNotification } from "./api";
import {
  notificationActionLabel,
  notificationIcon,
  notificationMetaLine,
  notificationTargetPage,
} from "./notificationWorkflow";

const notification = (overrides: Partial<WorkspaceNotification> = {}): WorkspaceNotification => ({
  id: "notice-1",
  type: "TASK_ASSIGNED",
  title: "新任务",
  message: "已分配给你",
  entityId: "TSK-1",
  createdAt: "2026-07-06T00:00:00.000Z",
  ...overrides,
});

describe("notification workflow helpers", () => {
  it("routes review requests to the review center", () => {
    expect(notificationTargetPage(notification({ type: "REVIEW_REQUESTED" }))).toBe("reviews");
    expect(notificationTargetPage(notification({ type: "TASK_REJECTED" }))).toBe("tasks");
  });

  it("returns role-friendly action labels and icons", () => {
    expect(notificationIcon(notification({ type: "TASK_REJECTED" }))).toBe("!");
    expect(notificationActionLabel(notification({ type: "REVIEW_REQUESTED" }))).toBe("去审核");
    expect(notificationActionLabel(notification({ type: "TASK_REJECTED" }))).toBe("去修改");
    expect(notificationActionLabel(notification({ type: "TASK_APPROVED" }))).toBe("看结果");
  });

  it("summarizes notification metadata without requiring new fields for old notifications", () => {
    expect(notificationMetaLine(notification())).toBe("");
    expect(notificationMetaLine(notification({
      metadata: {
        sku: "HC-001",
        version: 2,
        dueAt: "2026-07-08T18:00:00.000Z",
      },
    }))).toContain("HC-001 · V2 · 截止");
  });
});
