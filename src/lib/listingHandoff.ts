import type { EmployeeAccount, GenerationTask } from "../types/domain";

export interface ListingHandoffAction {
  tone: "ready" | "waiting";
  title: string;
  description: string;
  cta?: string;
}

export function canContinueTaskToListing(
  task: Pick<GenerationTask, "status" | "outputCount" | "outputAssetIds">,
  user: Pick<EmployeeAccount, "role">,
) {
  const hasApprovedOutput = task.status === "已通过"
    && ((task.outputCount ?? 0) > 0 || (task.outputAssetIds?.length ?? 0) > 0);
  const canManageListing = user.role === "管理员" || user.role === "运营";
  return hasApprovedOutput && canManageListing;
}

export function listingHandoffForTask(
  task: Pick<GenerationTask, "status" | "sku" | "type" | "outputCount" | "outputAssetIds" | "version">,
  user: Pick<EmployeeAccount, "role">,
): ListingHandoffAction | null {
  if (task.status !== "已通过") return null;

  const outputCount = Math.max(task.outputCount ?? 0, task.outputAssetIds?.length ?? 0);
  if (!outputCount) {
    return {
      tone: "waiting",
      title: "任务已通过，但缺少可交接成品",
      description: "请先确认成品图是否已上传并进入素材库，再继续 Listing 制作。",
    };
  }

  if (canContinueTaskToListing(task, user)) {
    return {
      tone: "ready",
      title: "视觉已通过，继续完善 Listing",
      description: `${task.sku} 的 ${task.type} 已通过审核（V${task.version ?? 1}，${outputCount} 张成品）。可进入 Listing 中心补标题、五点、模板字段和上传资料。`,
      cta: "去 Listing 中心",
    };
  }

  return {
    tone: "waiting",
    title: "视觉已交付给运营",
    description: `${task.sku} 的成品已通过审核，运营或管理员可以在 Listing 中心继续处理上架资料。`,
  };
}
