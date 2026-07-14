import { describe, expect, it } from "vitest";
import { canContinueTaskToListing, listingHandoffForTask } from "./listingHandoff";
import type { GenerationTask } from "../types/domain";

const task = (overrides: Partial<GenerationTask> = {}): GenerationTask => ({
  id: "TSK-12345678",
  productId: "prd-1",
  sku: "HC-001",
  productName: "Wall Art",
  type: "Amazon 六图套图",
  status: "已通过",
  progress: 100,
  owner: "张宁",
  assignedToId: "designer-1",
  assignedToName: "林晓",
  outputCount: 6,
  outputAssetIds: ["asset-1", "asset-2"],
  version: 2,
  updatedAt: "刚刚",
  ...overrides,
});

describe("任务到 Listing 交接", () => {
  it("仅运营和管理员可以从已通过任务继续处理 Listing", () => {
    expect(canContinueTaskToListing(task(), { role: "运营" })).toBe(true);
    expect(canContinueTaskToListing(task(), { role: "管理员" })).toBe(true);
    expect(canContinueTaskToListing(task(), { role: "设计" })).toBe(false);
    expect(canContinueTaskToListing(task({ status: "待审核" }), { role: "运营" })).toBe(false);
  });

  it("给运营返回可跳转 Listing 的交接动作", () => {
    const action = listingHandoffForTask(task(), { role: "运营" });

    expect(action).toMatchObject({
      tone: "ready",
      title: "视觉已通过，继续完善 Listing",
      cta: "去 Listing 中心",
    });
    expect(action?.description).toContain("6 张成品");
  });

  it("设计和审核只能看到已交付给运营", () => {
    const action = listingHandoffForTask(task(), { role: "设计" });

    expect(action).toMatchObject({
      tone: "waiting",
      title: "视觉已交付给运营",
    });
    expect(action?.cta).toBeUndefined();
  });

  it("已通过但没有成品时提示先确认成品资产", () => {
    const action = listingHandoffForTask(task({ outputCount: 0, outputAssetIds: [] }), { role: "运营" });

    expect(action).toMatchObject({
      tone: "waiting",
      title: "任务已通过，但缺少可交接成品",
    });
  });
});
