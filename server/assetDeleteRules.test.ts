import { describe, expect, it } from "vitest";
import { assetDeletionBlockReason } from "./assetDeleteRules.js";

describe("asset deletion rules", () => {
  it("blocks deleting assets attached to workspace tasks", () => {
    const reason = assetDeletionBlockReason(
      "asset-1.png",
      [{ id: "task-1", inputAssetIds: ["asset-1.png"], outputAssetIds: [] }],
      [],
    );
    expect(reason).toContain("任务使用");
  });

  it("blocks deleting images while queued or running jobs use them as references", () => {
    const reason = assetDeletionBlockReason(
      "reference-1.png",
      [],
      [{ status: "running", referenceAssetIds: ["reference-1.png"] }],
    );
    expect(reason).toContain("生图任务");
  });

  it("blocks deleting generated results that are linked to image jobs", () => {
    const reason = assetDeletionBlockReason(
      "result-1.png",
      [],
      [{ status: "succeeded", referenceAssetIds: [], resultAssetId: "result-1.png" }],
    );
    expect(reason).toContain("任务结果图");
  });

  it("allows deleting unattached assets", () => {
    expect(assetDeletionBlockReason("asset-1.png", [], [])).toBeNull();
  });
});
