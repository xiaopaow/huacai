import { describe, expect, it } from "vitest";
import { evaluateProductReadiness } from "./productReadiness";
import type { Product } from "../types/domain";

function product(overrides: Partial<Product> = {}): Product {
  return {
    id: "prd-1",
    sku: "HC-001",
    asin: "B0ABC12345",
    name: "墙面装饰画",
    brand: "花彩",
    category: "Home & Kitchen",
    marketplace: "美国站",
    status: "可生成",
    imageCount: 3,
    updatedAt: "刚刚",
    ...overrides,
  };
}

describe("商品资料完整度", () => {
  it("资料、ASIN 和多张原图完整时给出可直接生产状态", () => {
    const result = evaluateProductReadiness(product(), { minReferenceImages: 3 });

    expect(result.score).toBe(100);
    expect(result.tone).toBe("ready");
    expect(result.label).toBe("资料完整");
    expect(result.issues).toHaveLength(0);
  });

  it("新品没有 ASIN 和历史原图时只提示建议补充，不阻断 SKU 使用", () => {
    const result = evaluateProductReadiness(product({ asin: undefined, imageCount: 0 }));

    expect(result.tone).toBe("warning");
    expect(result.requiredIssues).toHaveLength(0);
    expect(result.recommendedIssues.map((issue) => issue.key)).toEqual(["asin", "reference-images"]);
    expect(result.score).toBeGreaterThanOrEqual(70);
  });

  it("创建六图任务时按当前上传原图数量判断，不误用历史图片数量", () => {
    const result = evaluateProductReadiness(product({ imageCount: 8 }), {
      referenceImageCount: 1,
      minReferenceImages: 3,
    });

    expect(result.referenceImageCount).toBe(1);
    expect(result.recommendedIssues.map((issue) => issue.key)).toContain("reference-images-count");
  });

  it("缺少核心商品字段时标记为资料不足", () => {
    const result = evaluateProductReadiness(product({
      sku: "",
      name: "",
      brand: "",
      category: "",
      asin: undefined,
      imageCount: 0,
    }));

    expect(result.tone).toBe("danger");
    expect(result.requiredIssues.map((issue) => issue.key)).toEqual(["sku", "name", "brand", "category"]);
    expect(result.score).toBeLessThan(50);
  });
});
