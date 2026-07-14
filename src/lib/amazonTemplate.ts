import readXlsxFile, { type Sheet, type SheetData } from "read-excel-file/browser";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import type { AmazonListing } from "../types/domain";

export type AmazonTemplateRequirement = "required" | "conditional" | "optional";

export interface AmazonTemplateField {
  group: string;
  attribute: string;
  label: string;
  description: string;
  example: string;
  requirement: AmazonTemplateRequirement;
}

export interface AmazonCategoryTemplate {
  fileName: string;
  productTypes: string[];
  marketplaceIds: string[];
  locales: string[];
  columnCount: number;
  columnAttributes: string[];
  attributeRowNumber: number;
  fields: AmazonTemplateField[];
  requiredCount: number;
  conditionalCount: number;
  optionalCount: number;
}

export interface AmazonTemplateCompletionField {
  field: AmazonTemplateField;
  value: string;
  filled: boolean;
  source: AmazonTemplateFieldSource;
}

export interface AmazonTemplateGroupSummary {
  group: string;
  total: number;
  filled: number;
}

export interface AmazonTemplateCompletionSummary {
  required: AmazonTemplateCompletionField[];
  conditional: AmazonTemplateCompletionField[];
  missingRequired: AmazonTemplateCompletionField[];
  requiredFilled: number;
  conditionalFilled: number;
  conditionalGroups: AmazonTemplateGroupSummary[];
}

export interface AmazonTemplateFieldSource {
  kind: "listing" | "preset" | "template";
  label: string;
  action: string;
}

const definitionSheetNames = ["数据定义", "data definitions", "data definition"];
const templateSheetNames = ["模板", "template"];

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim();
}

function findSheet(sheets: Sheet[], names: string[]) {
  return sheets.find((sheet) => names.includes(sheet.sheet.trim().toLowerCase()));
}

function classifyRequirement(value: string): AmazonTemplateRequirement {
  const normalized = value.trim().toLowerCase();
  if (
    normalized.includes("在一定条件下")
    || normalized.includes("conditionally required")
    || normalized.includes("required under")
  ) return "conditional";
  if (normalized === "必填" || normalized === "required" || normalized.startsWith("required ")) return "required";
  return "optional";
}

function parseDefinitionRows(rows: SheetData): AmazonTemplateField[] {
  const fields: AmazonTemplateField[] = [];
  let group = "";

  for (const row of rows) {
    const first = text(row[0]);
    const attribute = text(row[1]);
    if (first && !attribute && !/如何|how to/i.test(first)) {
      group = first;
      continue;
    }
    if (!attribute || !(/[#[.:]/.test(attribute) || attribute.startsWith("::"))) continue;
    if (/字段名称|field name/i.test(attribute)) continue;

    fields.push({
      group,
      attribute,
      label: text(row[2]) || attribute,
      description: text(row[3]),
      example: text(row[4]),
      requirement: classifyRequirement(text(row[5])),
    });
  }
  return fields;
}

function templateAttributeRow(rows: SheetData) {
  const index = rows.findIndex((row) => row.some((cell) => text(cell) === "contribution_sku#1.value"));
  if (index >= 0) return { row: rows[index], index };
  const fallbackIndex = rows.findIndex((row) => row.some((cell) => /marketplace_id=|language_tag=|::record_action/.test(text(cell))));
  return fallbackIndex >= 0 ? { row: rows[fallbackIndex], index: fallbackIndex } : null;
}

function collectMatches(values: string[], pattern: RegExp) {
  const matches = new Set<string>();
  for (const value of values) {
    for (const match of value.matchAll(pattern)) {
      if (match[1]) matches.add(match[1]);
    }
  }
  return [...matches];
}

function likelyProductTypes(sheets: Sheet[], values: string[]) {
  const result = new Set<string>();
  const mapSheet = sheets.find((sheet) => sheet.sheet.trim().toLowerCase() === "attributeptdmap");
  for (const row of mapSheet?.data ?? []) {
    const candidate = text(row[1]);
    if (/^[A-Z][A-Z0-9_]{2,}$/.test(candidate)) result.add(candidate);
  }
  for (const value of values) {
    for (const match of value.matchAll(/(?:productTypes?=|product_type[^A-Z0-9_]+)([A-Z][A-Z0-9_]{2,})/gi)) {
      result.add(match[1].toUpperCase());
    }
  }
  return [...result];
}

export function analyzeAmazonTemplateSheets(sheets: Sheet[], fileName = "Amazon-template.xlsx"): AmazonCategoryTemplate {
  const definitions = findSheet(sheets, definitionSheetNames);
  const template = findSheet(sheets, templateSheetNames);
  if (!definitions || !template) {
    throw new Error("未识别到 Amazon 的“数据定义”和“模板”工作表，请上传 Seller Central 下载的类目模板");
  }

  const fields = parseDefinitionRows(definitions.data);
  const attributeRow = templateAttributeRow(template.data);
  const attributes = attributeRow?.row.map(text) ?? [];
  if (!fields.length || !attributes.length) {
    throw new Error("模板字段结构不完整，可能不是 Amazon 类目上传模板");
  }

  const allText = sheets.flatMap((sheet) => sheet.data.flatMap((row) => row.map(text).filter(Boolean)));
  const marketplaceIds = collectMatches(allText, /marketplace_id=([A-Z0-9]+)/g);
  for (const value of allText.slice(0, 50)) {
    const decoded = decodeURIComponent(value);
    const match = decoded.match(/primaryMarketplaceId=amzn1\.mp\.o\.([A-Z0-9]+)/);
    if (match?.[1] && !marketplaceIds.includes(match[1])) marketplaceIds.push(match[1]);
  }
  const locales = collectMatches(allText, /language_tag=([a-z]{2}_[A-Z]{2})/g);
  const productTypes = likelyProductTypes(sheets, allText);
  const requiredCount = fields.filter((field) => field.requirement === "required").length;
  const conditionalCount = fields.filter((field) => field.requirement === "conditional").length;

  return {
    fileName,
    productTypes,
    marketplaceIds,
    locales,
    columnCount: attributes.filter(Boolean).length,
    columnAttributes: attributes,
    attributeRowNumber: (attributeRow?.index ?? 0) + 1,
    fields,
    requiredCount,
    conditionalCount,
    optionalCount: fields.length - requiredCount - conditionalCount,
  };
}

export async function analyzeAmazonTemplate(file: File) {
  const sheets = await readXlsxFile(file);
  return analyzeAmazonTemplateSheets(sheets, file.name);
}

function setFirstMatching(values: Record<string, string>, attributes: string[], prefix: string, value: string) {
  const attribute = attributes.find((candidate) => candidate === prefix || candidate.startsWith(`${prefix}[`) || candidate.startsWith(`${prefix}#`));
  if (attribute && value.trim()) values[attribute] = value.trim();
}

function setDefaultFirstMatching(values: Record<string, string>, attributes: string[], prefix: string, value: string) {
  const attribute = attributes.find((candidate) => candidate === prefix || candidate.startsWith(`${prefix}[`) || candidate.startsWith(`${prefix}#`));
  if (attribute && value.trim() && !values[attribute]?.trim()) values[attribute] = value.trim();
}

function setFirstMatchingBy(
  values: Record<string, string>,
  attributes: string[],
  predicate: (attribute: string) => boolean,
  value: string,
) {
  const attribute = attributes.find(predicate);
  if (attribute && value.trim()) values[attribute] = value.trim();
}

function setDefaultFirstMatchingBy(
  values: Record<string, string>,
  attributes: string[],
  predicate: (attribute: string) => boolean,
  value: string,
) {
  const attribute = attributes.find(predicate);
  if (attribute && value.trim() && !values[attribute]?.trim()) values[attribute] = value.trim();
}

export function amazonTemplateFieldSource(attribute: string): AmazonTemplateFieldSource {
  if (attribute.startsWith("manufacturer")) return { kind: "listing", label: "制造商/品牌", action: "默认跟随品牌，可按实际制造商覆盖" };
  if (attribute.startsWith("part_number")) return { kind: "listing", label: "Part Number", action: "默认跟随 SKU，可按公司编码规则覆盖" };
  if (attribute.startsWith("condition_type")) return { kind: "preset", label: "默认 New", action: "系统默认新品；二手/翻新商品需人工修改" };
  if (attribute.startsWith("package_level")) return { kind: "preset", label: "默认 Unit", action: "系统默认单件商品；套装/箱规需人工修改" };
  if (attribute.startsWith("country_of_origin")) return { kind: "preset", label: "默认 China", action: "系统默认中国原产；非中国制造需人工修改" };
  if (attribute.startsWith("batteries_required")) return { kind: "preset", label: "默认 No", action: "系统默认不需要电池；带电商品必须人工修改并补齐电池字段" };
  if (attribute.startsWith("has_multiple_battery_powered_components")) return { kind: "preset", label: "默认 No", action: "系统默认无多个电池供电组件；带电商品需人工确认" };
  if (attribute.startsWith("main_product_image_locator") || attribute.startsWith("other_product_image_locator")) {
    return { kind: "template", label: "图片 URL", action: "填入可公开访问的 Amazon 图片链接，本地上传图不能直接作为 URL" };
  }
  if (attribute.startsWith("merchant_shipping_group")) return { kind: "template", label: "配送模板", action: "填写 Seller Central 中真实存在的配送模板名称" };
  if (attribute.startsWith("fulfillment_availability") && attribute.includes("fulfillment_channel_code")) {
    return { kind: "template", label: "物流渠道", action: "FBM 通常留空；FBA 按店铺实际物流网络填写" };
  }
  if (attribute.startsWith("pesticide_marking") || attribute.startsWith("fcc_radio_frequency_emission_compliance")) {
    return { kind: "template", label: "美国合规", action: "按商品实际合规状态填写，不能直接套用示例值" };
  }
  if (attribute.startsWith("contribution_sku")) return { kind: "listing", label: "SKU", action: "编辑上方 SKU" };
  if (attribute.startsWith("product_type")) return { kind: "listing", label: "Product Type", action: "选择或填写 Product Type" };
  if (attribute.startsWith("item_name")) return { kind: "listing", label: "英文标题", action: "补充上方英文标题" };
  if (attribute.startsWith("brand")) return { kind: "listing", label: "品牌", action: "补充品牌字段" };
  if (attribute.startsWith("product_description")) return { kind: "listing", label: "商品描述", action: "补充商品描述" };
  if (attribute.startsWith("generic_keyword")) return { kind: "listing", label: "Search Terms", action: "补充搜索词" };
  if (attribute.startsWith("bullet_point")) return { kind: "listing", label: "五点卖点", action: "补齐五点卖点" };
  if (attribute.startsWith("fulfillment_availability") && attribute.endsWith(".quantity")) {
    return { kind: "listing", label: "库存", action: "填写库存" };
  }
  if (attribute.includes("purchasable_offer") && attribute.includes("our_price")) {
    return { kind: "listing", label: "售价", action: "填写售价" };
  }
  if (
    attribute.startsWith("amzn1.volt.ca.product_id_")
    || attribute.startsWith("externally_assigned_product_identifier")
  ) {
    return { kind: "listing", label: "ASIN/商品编码", action: "填写 ASIN 或商品编码" };
  }
  return { kind: "template", label: "类目字段", action: "在下方类目字段中人工填写" };
}

export function buildAmazonTemplateValues(
  listing: AmazonListing,
  template: AmazonCategoryTemplate,
): Record<string, string> {
  const values = { ...(listing.templateValues ?? {}) };
  const attributes = template.columnAttributes.filter(Boolean);
  setFirstMatching(values, attributes, "contribution_sku", listing.sku);
  setFirstMatching(values, attributes, "product_type", listing.productType);
  setFirstMatching(values, attributes, "item_name", listing.title);
  setFirstMatching(values, attributes, "brand", listing.brand);
  setFirstMatching(values, attributes, "product_description", listing.description);
  setFirstMatching(values, attributes, "generic_keyword", listing.searchTerms);
  setFirstMatching(values, attributes, "manufacturer", listing.brand);
  setDefaultFirstMatching(values, attributes, "part_number", listing.sku);
  setDefaultFirstMatching(values, attributes, "condition_type", "New");
  setDefaultFirstMatching(values, attributes, "package_level", "Unit");
  setDefaultFirstMatching(values, attributes, "country_of_origin", "China");
  setDefaultFirstMatching(values, attributes, "batteries_required", "No");
  setDefaultFirstMatchingBy(
    values,
    attributes,
    (attribute) => attribute.startsWith("has_multiple_battery_powered_components"),
    "No",
  );
  const quantityAttribute = attributes.find((attribute) => (
    attribute.startsWith("fulfillment_availability")
    && attribute.endsWith(".quantity")
  ));
  if (quantityAttribute) values[quantityAttribute] = String(listing.quantity);

  listing.bulletPoints.filter(Boolean).forEach((point, index) => {
    const matches = attributes.filter((attribute) => attribute.startsWith("bullet_point[") || attribute.startsWith("bullet_point#"));
    if (matches[index]) values[matches[index]] = point;
  });

  const priceAttribute = attributes.find((attribute) => (
    attribute.includes("purchasable_offer")
    && attribute.includes("our_price")
    && attribute.endsWith("value_with_tax")
  ));
  if (priceAttribute && listing.price > 0) values[priceAttribute] = String(listing.price);

  if (listing.asin?.trim()) {
    setFirstMatching(values, attributes, "amzn1.volt.ca.product_id_type", "ASIN");
    setFirstMatching(values, attributes, "amzn1.volt.ca.product_id_value", listing.asin);
    setFirstMatchingBy(
      values,
      attributes,
      (attribute) => attribute.startsWith("externally_assigned_product_identifier") && /\.type$|#\d+\.type$/.test(attribute),
      "ASIN",
    );
    setFirstMatchingBy(
      values,
      attributes,
      (attribute) => attribute.startsWith("externally_assigned_product_identifier") && /\.value$|#\d+\.value$/.test(attribute),
      listing.asin,
    );
  }
  return values;
}

export function missingAmazonTemplateFields(
  template: AmazonCategoryTemplate,
  values: Record<string, string>,
) {
  return template.fields.filter((field) => (
    field.requirement === "required"
    && !values[field.attribute]?.trim()
  ));
}

export function summarizeAmazonTemplateCompletion(
  template: AmazonCategoryTemplate,
  values: Record<string, string>,
): AmazonTemplateCompletionSummary {
  const completionFields = template.fields.map((field) => {
    const value = values[field.attribute]?.trim() ?? "";
    return { field, value, filled: Boolean(value), source: amazonTemplateFieldSource(field.attribute) };
  });
  const required = completionFields.filter((item) => item.field.requirement === "required");
  const conditional = completionFields.filter((item) => item.field.requirement === "conditional");
  const groups = new Map<string, AmazonTemplateGroupSummary>();

  for (const item of conditional) {
    const groupName = item.field.group || "未分组";
    const group = groups.get(groupName) ?? { group: groupName, total: 0, filled: 0 };
    group.total += 1;
    if (item.filled) group.filled += 1;
    groups.set(groupName, group);
  }

  return {
    required,
    conditional,
    missingRequired: required.filter((item) => !item.filled),
    requiredFilled: required.filter((item) => item.filled).length,
    conditionalFilled: conditional.filter((item) => item.filled).length,
    conditionalGroups: [...groups.values()].sort((a, b) => b.total - a.total || a.group.localeCompare(b.group)),
  };
}

function xmlUnescape(value: string) {
  return value
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function xmlEscape(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
}

function tagAttributes(tag: string) {
  const result: Record<string, string> = {};
  for (const match of tag.matchAll(/([\w:.-]+)="([^"]*)"/g)) result[match[1]] = xmlUnescape(match[2]);
  return result;
}

function worksheetPath(files: Record<string, Uint8Array>, sheetName: string) {
  const workbook = strFromU8(files["xl/workbook.xml"]);
  const relationshipId = [...workbook.matchAll(/<sheet\b[^>]*\/?>/g)]
    .map((match) => tagAttributes(match[0]))
    .find((attributes) => attributes.name === sheetName)?.["r:id"];
  if (!relationshipId) throw new Error(`找不到“${sheetName}”工作表`);

  const relationships = strFromU8(files["xl/_rels/workbook.xml.rels"]);
  const target = [...relationships.matchAll(/<Relationship\b[^>]*\/?>/g)]
    .map((match) => tagAttributes(match[0]))
    .find((attributes) => attributes.Id === relationshipId)?.Target;
  if (!target) throw new Error("Amazon 模板工作表关系损坏");
  return target.startsWith("/") ? target.slice(1) : `xl/${target.replace(/^(\.\.\/)+/, "")}`;
}

function excelColumn(index: number) {
  let value = index + 1;
  let result = "";
  while (value > 0) {
    value -= 1;
    result = String.fromCharCode(65 + (value % 26)) + result;
    value = Math.floor(value / 26);
  }
  return result;
}

export async function createFilledAmazonTemplate(
  source: File | Blob | ArrayBuffer,
  template: AmazonCategoryTemplate,
  values: Record<string, string>,
) {
  const bytes = source instanceof ArrayBuffer
    ? new Uint8Array(source)
    : new Uint8Array(await source.arrayBuffer());
  const files = unzipSync(bytes);
  const path = worksheetPath(files, "模板");
  const original = strFromU8(files[path]);
  const rowNumbers = [...original.matchAll(/<row\b[^>]*\br="(\d+)"/g)].map((match) => Number(match[1]));
  const rowNumber = Math.max(template.attributeRowNumber, ...rowNumbers) + 1;
  const cells = template.columnAttributes.map((attribute, index) => {
    const value = attribute ? values[attribute]?.trim() : "";
    if (!value) return "";
    const reference = `${excelColumn(index)}${rowNumber}`;
    return `<c r="${reference}" t="inlineStr"><is><t xml:space="preserve">${xmlEscape(value)}</t></is></c>`;
  }).join("");
  if (!cells) throw new Error("还没有可导出的 Listing 数据");
  const row = `<row r="${rowNumber}">${cells}</row>`;
  let updated = original.replace("</sheetData>", `${row}</sheetData>`);
  updated = updated.replace(
    /<dimension\b([^>]*?)ref="([A-Z]+\d+):([A-Z]+)(\d+)"([^>]*)\/>/,
    (_match, before, start, endColumn, endRow, after) => (
      `<dimension${before}ref="${start}:${endColumn}${Math.max(Number(endRow), rowNumber)}"${after}/>`
    ),
  );
  files[path] = strToU8(updated);
  return zipSync(files, { level: 6 });
}

export async function downloadFilledAmazonTemplate(
  source: File,
  template: AmazonCategoryTemplate,
  values: Record<string, string>,
  outputName: string,
) {
  const bytes = await createFilledAmazonTemplate(source, template, values);
  const extension = source.name.toLowerCase().endsWith(".xlsm") ? "xlsm" : "xlsx";
  const mime = extension === "xlsm"
    ? "application/vnd.ms-excel.sheet.macroEnabled.12"
    : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  const blob = new Blob([bytes], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${outputName.replace(/[<>:"/\\|?*]+/g, "-")}.${extension}`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
