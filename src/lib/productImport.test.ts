import { describe, expect, it } from "vitest";
import { buildProductImportPreview } from "./productImport";

describe("SKU 表格导入解析", () => {
  it("识别中英文表头并规范站点与 ASIN", () => {
    const preview = buildProductImportPreview([
      ["Seller SKU", "商品名称", "Brand", "Product Type", "Marketplace", "ASIN"],
      ["HC-CUP-001", "不锈钢保温杯", "花彩", "Home & Kitchen", "US", "b0abc12345"],
      ["HC-LAMP-002", "桌面灯", "花彩", "Lighting", "德国站", ""],
    ], []);

    expect(preview.error).toBeUndefined();
    expect(preview.rows).toHaveLength(2);
    expect(preview.rows[0].issues).toEqual([]);
    expect(preview.rows[0].product).toMatchObject({
      sku: "HC-CUP-001",
      marketplace: "美国站",
      asin: "B0ABC12345",
    });
    expect(preview.rows[1].product.marketplace).toBe("德国站");
  });

  it("在预览阶段标记商品库重复和文件内重复", () => {
    const preview = buildProductImportPreview([
      ["SKU", "商品名称", "品牌"],
      ["EXISTING-001", "已有商品", "花彩"],
      ["NEW-001", "新商品 A", "花彩"],
      ["new-001", "新商品 B", "花彩"],
    ], ["existing-001"]);

    expect(preview.rows[0].issues).toContain("SKU 已存在");
    expect(preview.rows[1].issues).toEqual([]);
    expect(preview.rows[2].issues).toContain("文件内 SKU 重复");
  });

  it("缺少必填列时拒绝继续导入", () => {
    const preview = buildProductImportPreview([
      ["SKU", "商品名称"],
      ["HC-001", "测试商品"],
    ], []);

    expect(preview.rows).toEqual([]);
    expect(preview.error).toBe("缺少必填列：品牌");
  });
});
