import { describe, expect, it } from "vitest";
import { canRestoreListingGeneration, visibleListingGenerationsForEmployee } from "./listingHistoryRules.js";
import type { ListingGenerationRecord } from "./types.js";

const record = (id: string, generatedById: string): ListingGenerationRecord => ({
  id,
  listingId: `listing-${id}`,
  version: 1,
  sku: id,
  marketplaceName: "美国站",
  productType: "WALL_ART",
  brand: "FLORA",
  generatedById,
  generatedByName: generatedById,
  competitorAsin: "B012345678",
  competitorUrl: "https://www.amazon.com/dp/B012345678",
  model: "openai/gpt-5.4",
  generationMode: "competitor_first",
  title: "Title",
  bulletPoints: ["1", "2", "3", "4", "5"],
  description: "Description",
  searchTerms: "search terms",
  compliance: { compliant: true, issues: [] },
  generatedAt: "2026-07-13T00:00:00.000Z",
});

describe("Listing 历史权限", () => {
  const records = [record("one", "ops-1"), record("two", "ops-2")];

  it("管理员能查看和恢复全部员工版本", () => {
    expect(visibleListingGenerationsForEmployee(records, { id: "admin", role: "管理员" })).toHaveLength(2);
    expect(canRestoreListingGeneration(records[1], { id: "admin", role: "管理员" })).toBe(true);
  });

  it("运营只能查看和恢复自己生成的版本", () => {
    expect(visibleListingGenerationsForEmployee(records, { id: "ops-1", role: "运营" }).map((item) => item.id)).toEqual(["one"]);
    expect(canRestoreListingGeneration(records[1], { id: "ops-1", role: "运营" })).toBe(false);
  });

  it("设计和审核即使直接调用规则也只能得到自己的记录", () => {
    expect(visibleListingGenerationsForEmployee(records, { id: "designer", role: "设计" })).toEqual([]);
    expect(visibleListingGenerationsForEmployee(records, { id: "reviewer", role: "审核" })).toEqual([]);
  });
});
