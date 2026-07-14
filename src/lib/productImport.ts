import readXlsxFile from "read-excel-file/browser";
import type { Marketplace, Product } from "../types/domain";

export interface ProductImportPreviewRow {
  rowNumber: number;
  product: Product;
  issues: string[];
}

export interface ProductImportPreview {
  rows: ProductImportPreviewRow[];
  error?: string;
}

const headerAliases: Record<string, string[]> = {
  sku: ["sku", "商品sku", "商家sku", "seller sku"],
  name: ["商品名称", "产品名称", "名称", "product name", "name"],
  brand: ["品牌", "brand"],
  category: ["amazon类目", "类目", "分类", "category", "product type"],
  marketplace: ["目标站点", "站点", "市场", "marketplace", "marketplace id"],
  asin: ["asin", "商品asin"],
};

function normalizeHeader(value: unknown) {
  return String(value ?? "").trim().toLowerCase().replace(/[\s_-]+/g, "");
}

function resolveColumns(header: unknown[]) {
  const normalized = header.map(normalizeHeader);
  return Object.fromEntries(
    Object.entries(headerAliases).map(([key, aliases]) => [
      key,
      normalized.findIndex((cell) => aliases.map(normalizeHeader).includes(cell)),
    ]),
  ) as Record<keyof typeof headerAliases, number>;
}

function cellText(row: unknown[], index: number) {
  return index >= 0 ? String(row[index] ?? "").trim() : "";
}

function normalizeMarketplace(value: string): Marketplace | undefined {
  const normalized = value.trim().toLowerCase().replace(/\s+/g, "");
  const aliases: Record<string, Marketplace> = {
    "": "美国站",
    "美国": "美国站",
    "美国站": "美国站",
    "us": "美国站",
    "usa": "美国站",
    "英国": "英国站",
    "英国站": "英国站",
    "uk": "英国站",
    "德国": "德国站",
    "德国站": "德国站",
    "de": "德国站",
    "日本": "日本站",
    "日本站": "日本站",
    "jp": "日本站",
  };
  return aliases[normalized];
}

export function buildProductImportPreview(rows: unknown[][], existingSkus: string[]): ProductImportPreview {
  if (rows.length < 2) return { rows: [], error: "表格至少需要一行表头和一行商品数据" };
  const columns = resolveColumns(rows[0]);
  const missing = [
    columns.sku < 0 ? "SKU" : "",
    columns.name < 0 ? "商品名称" : "",
    columns.brand < 0 ? "品牌" : "",
  ].filter(Boolean);
  if (missing.length) return { rows: [], error: `缺少必填列：${missing.join("、")}` };

  const existing = new Set(existingSkus.map((sku) => sku.trim().toLowerCase()));
  const seen = new Set<string>();
  const previewRows: ProductImportPreviewRow[] = [];

  rows.slice(1).forEach((row, index) => {
    if (row.every((cell) => String(cell ?? "").trim() === "")) return;
    const sku = cellText(row, columns.sku);
    const name = cellText(row, columns.name);
    const brand = cellText(row, columns.brand);
    const category = cellText(row, columns.category) || "未分类";
    const marketplaceValue = cellText(row, columns.marketplace);
    const marketplace = normalizeMarketplace(marketplaceValue);
    const asin = cellText(row, columns.asin).toUpperCase();
    const normalizedSku = sku.toLowerCase();
    const issues: string[] = [];

    if (!sku) issues.push("缺少 SKU");
    if (!name) issues.push("缺少商品名称");
    if (!brand) issues.push("缺少品牌");
    if (sku && existing.has(normalizedSku)) issues.push("SKU 已存在");
    if (sku && seen.has(normalizedSku)) issues.push("文件内 SKU 重复");
    if (!marketplace) issues.push(`不支持的站点：${marketplaceValue}`);
    if (asin && !/^[A-Z0-9]{10}$/.test(asin)) issues.push("ASIN 应为 10 位字母或数字");
    if (sku) seen.add(normalizedSku);

    previewRows.push({
      rowNumber: index + 2,
      product: {
        id: `prd-import-${Date.now()}-${index}`,
        sku,
        asin: asin || undefined,
        name,
        brand,
        category,
        marketplace: marketplace ?? "美国站",
        status: "资料待完善",
        imageCount: 0,
        updatedAt: "刚刚",
      },
      issues,
    });
  });

  if (previewRows.length > 500) return { rows: previewRows, error: `文件包含 ${previewRows.length} 个 SKU，单次最多导入 500 个` };
  return previewRows.length ? { rows: previewRows } : { rows: [], error: "表格中没有可导入的商品数据" };
}

function parseCsvLine(line: string, delimiter: string) {
  const cells: string[] = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === "\"") {
      if (quoted && line[index + 1] === "\"") {
        value += "\"";
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === delimiter && !quoted) {
      cells.push(value);
      value = "";
    } else {
      value += character;
    }
  }
  cells.push(value);
  return cells;
}

function parseDelimitedText(text: string) {
  const clean = text.replace(/^\uFEFF/, "");
  const lines = clean.split(/\r?\n/).filter((line) => line.trim());
  const delimiter = lines[0]?.includes("\t") ? "\t" : ",";
  return lines.map((line) => parseCsvLine(line, delimiter));
}

export async function readProductImportFile(file: File, existingSkus: string[]) {
  const extension = file.name.split(".").pop()?.toLowerCase();
  const rows = extension === "csv" || extension === "tsv"
    ? parseDelimitedText(await file.text())
    : await readXlsxFile(file);
  return buildProductImportPreview(rows as unknown[][], existingSkus);
}

export function downloadProductImportTemplate() {
  const content = [
    ["SKU", "商品名称", "品牌", "Amazon 类目", "目标站点", "ASIN"],
    ["HC-EXAMPLE-001", "示例商品（请删除此行）", "公司品牌", "Home & Kitchen", "美国站", ""],
  ].map((row) => row.map((cell) => `"${cell.replaceAll("\"", "\"\"")}"`).join(",")).join("\r\n");
  const url = URL.createObjectURL(new Blob([`\uFEFF${content}`], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "花彩-SKU导入模板.csv";
  link.click();
  URL.revokeObjectURL(url);
}
