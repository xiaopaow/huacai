import type { WorkspaceNotification } from "./api";
import type { PageKey } from "../types/domain";

export function notificationTargetPage(notification: WorkspaceNotification): Extract<PageKey, "tasks" | "reviews"> {
  if (notification.targetPage === "reviews" || notification.type === "REVIEW_REQUESTED") return "reviews";
  return "tasks";
}

export function notificationIcon(notification: WorkspaceNotification) {
  switch (notification.type) {
    case "TASK_ASSIGNED":
      return "→";
    case "REVIEW_REQUESTED":
      return "✓";
    case "TASK_APPROVED":
      return "●";
    case "TASK_REJECTED":
      return "!";
    default:
      return "◇";
  }
}

export function notificationActionLabel(notification: WorkspaceNotification) {
  const action = notification.metadata?.action;
  if (action === "review_task" || notification.type === "REVIEW_REQUESTED") return "去审核";
  if (action === "revise_task" || notification.type === "TASK_REJECTED") return "去修改";
  if (action === "view_result" || notification.type === "TASK_APPROVED") return "看结果";
  return "去处理";
}

export function notificationMetaLine(notification: WorkspaceNotification) {
  const parts = [
    notification.metadata?.sku,
    notification.metadata?.version ? `V${notification.metadata.version}` : "",
    notification.metadata?.dueAt ? `截止 ${new Date(notification.metadata.dueAt).toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" })}` : "",
  ].filter(Boolean);
  return parts.join(" · ");
}
