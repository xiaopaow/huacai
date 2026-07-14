import { randomUUID } from "node:crypto";
import type { WorkspaceProduct } from "./types.js";

export function validateProductImport(
  input: WorkspaceProduct[],
  existingProducts: WorkspaceProduct[],
  createId: () => string = () => `prd-${randomUUID()}`,
) {
  const existingSkus = new Set(existingProducts.map((product) => product.sku.trim().toLowerCase()));
  const importedSkus = new Set<string>();
  const allowedMarketplaces = new Set(["美国站", "英国站", "德国站", "日本站"]);
  const errors: string[] = [];
  const products = input.map((product, index): WorkspaceProduct => {
    const sku = String(product.sku ?? "").trim();
    const name = String(product.name ?? "").trim();
    const brand = String(product.brand ?? "").trim();
    const category = String(product.category ?? "").trim() || "未分类";
    const marketplace = String(product.marketplace ?? "").trim() || "美国站";
    const asin = product.asin ? String(product.asin).trim().toUpperCase() : undefined;
    const normalizedSku = sku.toLowerCase();
    const rowLabel = `第 ${index + 1} 条`;

    if (!sku || !name || !brand) errors.push(`${rowLabel}缺少 SKU、商品名称或品牌`);
    if (sku && existingSkus.has(normalizedSku)) errors.push(`${rowLabel} SKU ${sku} 已存在`);
    if (sku && importedSkus.has(normalizedSku)) errors.push(`${rowLabel} SKU ${sku} 在文件内重复`);
    if (!allowedMarketplaces.has(marketplace)) errors.push(`${rowLabel}站点不受支持`);
    if (asin && !/^[A-Z0-9]{10}$/.test(asin)) errors.push(`${rowLabel} ASIN 格式无效`);
    if (sku) importedSkus.add(normalizedSku);

    return {
      id: createId(),
      sku,
      asin,
      name,
      brand,
      category,
      marketplace,
      status: "资料待完善",
      imageCount: 0,
      updatedAt: "刚刚",
    };
  });

  return { products, errors };
}
