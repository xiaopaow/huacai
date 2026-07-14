import type { Employee, ImageGenerationJob, UploadedAssetRecord } from "./types.js";

export function canAccessImageJob(job: Pick<ImageGenerationJob, "ownerId">, viewer: Pick<Employee, "id" | "role">) {
  return job.ownerId === viewer.id || viewer.role === "管理员";
}

export function canCreateImageGenerationJob(viewer: Pick<Employee, "role">) {
  return viewer.role === "管理员" || viewer.role === "运营" || viewer.role === "设计";
}

export function hasInvalidOwnedReferenceAsset(
  referenceAssetIds: string[],
  uploadedAssets: Pick<UploadedAssetRecord, "id" | "ownerId">[],
  ownerId: string,
) {
  return referenceAssetIds.some((id) => {
    const asset = uploadedAssets.find((item) => item.id === id);
    return !asset || asset.ownerId !== ownerId;
  });
}
