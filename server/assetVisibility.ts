import { visibleTasksForEmployee } from "./taskVisibility.js";
import type { Employee, GeneratedAsset, UploadedAssetRecord, WorkspaceTask } from "./types.js";

type Viewer = Pick<Employee, "id" | "role" | "name">;

function canReuseTeamAssets(viewer: Pick<Employee, "role">) {
  return viewer.role === "管理员" || viewer.role === "运营";
}

function visibleTaskUsesAsset(task: WorkspaceTask, assetId: string) {
  return task.inputAssetIds?.includes(assetId) || task.outputAssetIds?.includes(assetId);
}

export function canViewUploadedAsset(
  asset: UploadedAssetRecord,
  tasks: WorkspaceTask[],
  viewer: Viewer,
) {
  if (asset.ownerId === viewer.id || canReuseTeamAssets(viewer)) return true;
  if (asset.purpose === "reference") return false;
  return visibleTasksForEmployee(tasks, viewer).some((task) =>
    task.id === asset.taskId || visibleTaskUsesAsset(task, asset.id),
  );
}

export function canViewGeneratedAsset(
  asset: GeneratedAsset,
  tasks: WorkspaceTask[],
  viewer: Viewer,
) {
  if (asset.ownerId === viewer.id || canReuseTeamAssets(viewer)) return true;
  return visibleTasksForEmployee(tasks, viewer).some((task) => task.outputAssetIds?.includes(asset.id));
}

export function visibleGeneratedAssetsForEmployee(
  assets: GeneratedAsset[],
  tasks: WorkspaceTask[],
  viewer: Viewer,
) {
  return assets.filter((asset) => canViewGeneratedAsset(asset, tasks, viewer));
}

export function publicAssetOwnerName(
  owner: Pick<Employee, "id" | "name"> | undefined,
  viewer: Viewer,
  ownerNameSnapshot?: string,
) {
  if (viewer.role === "管理员" || owner?.id === viewer.id) return owner?.name ?? ownerNameSnapshot ?? "历史账号";
  return "团队成员";
}
