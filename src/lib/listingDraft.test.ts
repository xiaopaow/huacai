import { describe, expect, it } from "vitest";
import {
  buildListingCreateInputFromProduct,
  buildListingDraftCopyFromProduct,
  mergeListingDraftCopyFromProduct,
} from "./listingDraft";
import type { AmazonListing, Product } from "../types/domain";

const product: Product = {
  id: "prd-wall-art",
  sku: "HC-WA-001",
  asin: "B0ABC12345",
  name: "Framed Canvas Wall Art",
  brand: "Huacai",
  category: "Wall Art",
  marketplace: "美国站",
  status: "可生成",
  imageCount: 3,
  updatedAt: "刚刚",
};

const listing = (overrides: Partial<AmazonListing> = {}): AmazonListing => ({
  id: "listing-1",
  sku: "HC-WA-001",
  marketplaceId: "ATVPDKIKX0DER",
  marketplaceName: "美国站",
  productType: "WALL_ART",
  title: "",
  brand: "",
  description: "",
  bulletPoints: ["", "", "", "", ""],
  searchTerms: "",
  price: 0,
  currency: "USD",
  quantity: 0,
  status: "草稿",
  ownerId: "employee-1",
  issues: [],
  updatedAt: "2026-07-02T00:00:00.000Z",
  ...overrides,
});

describe("Listing 初稿助手", () => {
  it("从 SKU 商品资料生成运营初稿", () => {
    const copy = buildListingDraftCopyFromProduct(product, "美国站");

    expect(copy.title).toBe("Huacai Framed Canvas Wall Art");
    expect(copy.brand).toBe("Huacai");
    expect(copy.bulletPoints).toHaveLength(5);
    expect(copy.bulletPoints[0]).toContain("待补充");
    expect(copy.searchTerms).toContain("huacai");
    expect(copy.searchTerms).toContain("wall");
  });

  it("创建 Listing 时预填标题、品牌、五点、描述和搜索词", () => {
    const input = buildListingCreateInputFromProduct(product, {
      id: "ATVPDKIKX0DER",
      name: "美国站",
      currency: "USD",
    });

    expect(input).toMatchObject({
      sku: "HC-WA-001",
      asin: "B0ABC12345",
      title: "Huacai Framed Canvas Wall Art",
      brand: "Huacai",
      marketplaceId: "ATVPDKIKX0DER",
      currency: "USD",
    });
    expect(input.bulletPoints).toHaveLength(5);
    expect(input.description).toContain("待补充");
  });

  it("补空字段时不覆盖运营已经手写的内容", () => {
    const merged = mergeListingDraftCopyFromProduct(
      listing({
        title: "Manual Customer Facing Title",
        bulletPoints: ["Manual benefit", "", "", "", ""],
      }),
      product,
    );

    expect(merged.title).toBe("Manual Customer Facing Title");
    expect(merged.bulletPoints[0]).toBe("Manual benefit");
    expect(merged.bulletPoints[1]).toContain("待补充");
    expect(merged.asin).toBe("B0ABC12345");
  });
});
