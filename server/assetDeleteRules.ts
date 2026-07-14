import type { ImageGenerationJob, WorkspaceTask } from "./types.js";

export function assetDeletionBlockReason(
  assetId: string,
  tasks: Pick<WorkspaceTask, "id" | "inputAssetIds" | "outputAssetIds">[],
  imageJobs: Pick<ImageGenerationJob, "status" | "referenceAssetIds" | "resultAssetId" | "resultAssetIds">[],
) {
  const usedByTask = tasks.some((task) => {
    return task.inputAssetIds?.includes(assetId) || task.outputAssetIds?.includes(assetId);
  });
  if (usedByTask) {
    return "素材已被任务使用，不能直接删除；如需替换，请在对应任务中重新上传或提交新版";
  }

  const usedByRunningImageJob = imageJobs.some((job) => {
    const active = job.status === "queued" || job.status === "running";
    return active && job.referenceAssetIds.includes(assetId);
  });
  if (usedByRunningImageJob) {
    return "素材正在被生图任务使用，任务结束后再删除";
  }

  const usedAsImageJobResult = imageJobs.some((job) => {
    return job.resultAssetId === assetId || job.resultAssetIds?.includes(assetId);
  });
  if (usedAsImageJobResult) {
    return "素材已作为生图任务结果保存，不能直接删除任务结果图";
  }

  return null;
}
