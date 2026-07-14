import { describe, expect, it } from "vitest";
import { canDeleteLocalListing, dedupeLocalListingDrafts, findListingConflict } from "./listingRules.js";
import type { AmazonListing } from "./types.js";

const listing = (overrides: Partial<AmazonListing> = {}): AmazonListing => ({
  id: "listing-1",
  sku: "HC-001",
  marketplaceId: "ATVPDKIKX0DER",
  marketplaceName: "美国站",
  productType: "WALL_ART",
  title: "Wall Art",
  brand: "Huacai",
  description: "Description",
  bulletPoints: ["1", "2", "3", "4", "5"],
  searchTerms: "wall art",
  price: 20,
  currency: "USD",
  quantity: 10,
  status: "草稿",
  ownerId: "employee-1",
  issues: [],
  updatedAt: "2026-07-02T00:00:00.000Z",
  ...overrides,
});

describe("Listing rules", () => {
  it("treats SKU as case-insensitive within one marketplace", () => {
    expect(findListingConflict([listing()], { sku: " hc-001 ", marketplaceId: "ATVPDKIKX0DER" })?.id)
      .toBe("listing-1");
    expect(findListingConflict([listing()], { sku: "HC-001", marketplaceId: "A1F83G8C2ARO7P" }))
      .toBeUndefined();
    expect(findListingConflict([listing()], { sku: "HC-001", marketplaceId: "ATVPDKIKX0DER" }, "listing-1"))
      .toBeUndefined();
  });

  it("only blocks deletion after a listing has entered Amazon processing", () => {
    expect(canDeleteLocalListing("草稿")).toBe(true);
    expect(canDeleteLocalListing("失败")).toBe(true);
    expect(canDeleteLocalListing("提交中")).toBe(false);
    expect(canDeleteLocalListing("已发布")).toBe(false);
  });

  it("keeps the latest editable draft for the same SKU and marketplace", () => {
    const older = listing({ id: "old", updatedAt: "2026-07-01T00:00:00.000Z" });
    const newer = listing({ id: "new", updatedAt: "2026-07-02T00:00:00.000Z" });
    const otherMarketplace = listing({
      id: "uk",
      marketplaceId: "A1F83G8C2ARO7P",
      updatedAt: "2026-07-01T00:00:00.000Z",
    });

    const result = dedupeLocalListingDrafts([older, newer, otherMarketplace]);

    expect(result.listings.map((item) => item.id)).toEqual(["new", "uk"]);
    expect(result.removed.map((item) => item.id)).toEqual(["old"]);
  });

  it("does not remove submitted or published Amazon listings when deduplicating", () => {
    const submitted = listing({ id: "submitted", status: "提交中", updatedAt: "2026-07-01T00:00:00.000Z" });
    const draft = listing({ id: "draft", status: "待完善", updatedAt: "2026-07-02T00:00:00.000Z" });
    const published = listing({ id: "published", sku: "HC-002", status: "已发布", updatedAt: "2026-07-01T00:00:00.000Z" });
    const duplicateDraft = listing({ id: "duplicate-draft", sku: "HC-002", status: "草稿", updatedAt: "2026-07-03T00:00:00.000Z" });

    const result = dedupeLocalListingDrafts([submitted, draft, published, duplicateDraft]);

    expect(result.listings.map((item) => item.id)).toEqual(["submitted", "published"]);
    expect(result.removed.map((item) => item.id)).toEqual(["draft", "duplicate-draft"]);
  });
});
