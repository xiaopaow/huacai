import { describe, expect, it } from "vitest";
import { normalizeProductInput, productDeletionBlockReason } from "./productRules.js";
import type { WorkspaceProduct } from "./types.js";

function product(overrides: Partial<WorkspaceProduct> = {}): WorkspaceProduct {
  return {
    id: "client-id",
    sku: " HC-001 ",
    asin: "b0abc12345",
    name: " 商品名称 ",
    brand: " 公司品牌 ",
    category: " Home & Kitchen ",
    marketplace: "美国站",
    status: "资料待完善",
    imageCount: 2,
    updatedAt: "刚刚",
    ...overrides,
  };
}

describe("商品资料服务端规则", () => {
  it("规范文本、ASIN 并使用服务端商品编号", () => {
    const result = normalizeProductInput(product(), "prd-server");
    expect(result.error).toBeUndefined();
    expect(result.product).toMatchObject({
      id: "prd-server",
      sku: "HC-001",
      asin: "B0ABC12345",
      name: "商品名称",
      brand: "公司品牌",
      category: "Home & Kitchen",
    });
  });

  it("拒绝无效 ASIN、站点和状态", () => {
    expect(normalizeProductInput(product({ asin: "bad" }), "id").error).toContain("ASIN");
    expect(normalizeProductInput(product({ marketplace: "加拿大站" }), "id").error).toContain("站点");
    expect(normalizeProductInput(product({ status: "未知" }), "id").error).toContain("状态");
  });

  it("阻止删除仍有关联任务或 Listing 的 SKU 商品", () => {
    const base = { id: "prd-1", sku: "HC-001" };
    expect(productDeletionBlockReason(base, [{ productId: "prd-1" }], [])).toContain("生产任务");
    expect(productDeletionBlockReason(base, [], [{ sku: "hc-001" }])).toContain("Amazon Listing");
    expect(productDeletionBlockReason(base, [], [{ sku: "HC-002" }])).toBeNull();
  });
});
