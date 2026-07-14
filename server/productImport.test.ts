import { describe, expect, it } from "vitest";
import { validateProductImport } from "./productImport.js";
import type { WorkspaceProduct } from "./types.js";

const existing: WorkspaceProduct = {
  id: "existing",
  sku: "EXISTING-001",
  name: "已有商品",
  brand: "花彩",
  category: "Home & Kitchen",
  marketplace: "美国站",
  status: "可生成",
  imageCount: 1,
  updatedAt: "2026-07-02",
};

function input(sku: string, overrides: Partial<WorkspaceProduct> = {}): WorkspaceProduct {
  return {
    ...existing,
    id: "client-id",
    sku,
    name: "导入商品",
    imageCount: 99,
    ...overrides,
  };
}

describe("后端 SKU 批量导入校验", () => {
  it("整批识别已有 SKU、文件重复与非法字段", () => {
    const result = validateProductImport([
      input("existing-001"),
      input("NEW-001", { marketplace: "加拿大站" }),
      input("new-001", { asin: "BAD" }),
    ], [existing], () => "generated-id");

    expect(result.errors).toEqual(expect.arrayContaining([
      expect.stringContaining("已存在"),
      expect.stringContaining("站点不受支持"),
      expect.stringContaining("文件内重复"),
      expect.stringContaining("ASIN 格式无效"),
    ]));
  });

  it("规范字段并由服务端生成商品编号", () => {
    const result = validateProductImport([
      input("  COMPANY-001  ", {
        name: "  公司商品  ",
        brand: "  公司品牌  ",
        category: "  ",
        marketplace: "",
        asin: "b0abc12345",
      }),
    ], [], () => "prd-server-generated");

    expect(result.errors).toEqual([]);
    expect(result.products[0]).toMatchObject({
      id: "prd-server-generated",
      sku: "COMPANY-001",
      name: "公司商品",
      brand: "公司品牌",
      category: "未分类",
      marketplace: "美国站",
      asin: "B0ABC12345",
      imageCount: 0,
      status: "资料待完善",
    });
  });
});
