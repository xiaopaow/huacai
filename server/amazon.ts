import type { AmazonListing } from "./types.js";
import { ProxyAgent, fetch as undiciFetch } from "undici";
import { validateGeneratedListingCopy } from "./listingGeneration.js";

let cachedDispatcher: ProxyAgent | undefined;
let lwaTokenCache: { token: string; expiresAt: number } | null = null;
const productTypeDefinitionCache = new Map<string, {
  expiresAt: number;
  definition: AmazonProductTypeDefinition;
  schema: AmazonProductTypeSchema;
}>();

export interface AmazonProductTypeSummary {
  name: string;
  displayName: string;
  marketplaceIds: string[];
  productTypeVersion: {
    version: string;
    latest: boolean;
    releaseCandidate: boolean;
  };
}

interface AmazonSchemaLink {
  link: { resource: string; verb: string };
  checksum: string;
}

export interface AmazonProductTypeDefinition {
  metaSchema: AmazonSchemaLink;
  schema: AmazonSchemaLink;
  requirements: string;
  requirementsEnforced: string;
  propertyGroups: Record<string, {
    title: string;
    description?: string;
    propertyNames: string[];
  }>;
  locale: string;
  marketplaceIds: string[];
  productType: string;
  displayName: string;
  productTypeVersion: {
    version: string;
    latest: boolean;
    releaseCandidate: boolean;
  };
}

export interface AmazonProductTypeSchema {
  $schema?: string;
  properties?: Record<string, Record<string, unknown>>;
  required?: string[];
  [key: string]: unknown;
}

export interface AmazonProductTypeFieldSummary {
  name: string;
  title: string;
  description: string;
  group: string;
  groupTitle: string;
  required: boolean;
  enumValues: string[];
  minItems?: number;
  maxItems?: number;
}

function amazonDispatcher() {
  const outboundProxy = process.env.OUTBOUND_PROXY || process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
  if (outboundProxy && !cachedDispatcher) cachedDispatcher = new ProxyAgent(outboundProxy);
  return cachedDispatcher;
}

export const marketplaces = {
  "ATVPDKIKX0DER": { name: "美国站", endpoint: "https://sellingpartnerapi-na.amazon.com", currency: "USD" },
  "A1F83G8C2ARO7P": { name: "英国站", endpoint: "https://sellingpartnerapi-eu.amazon.com", currency: "GBP" },
  "A1PA6795UKMFR9": { name: "德国站", endpoint: "https://sellingpartnerapi-eu.amazon.com", currency: "EUR" },
  "A1VC38T7YXB528": { name: "日本站", endpoint: "https://sellingpartnerapi-fe.amazon.com", currency: "JPY" },
} as const;

export function amazonConfigured() {
  return Boolean(
    process.env.AMAZON_SELLER_ID &&
    process.env.AMAZON_LWA_CLIENT_ID &&
    process.env.AMAZON_LWA_CLIENT_SECRET &&
    process.env.AMAZON_REFRESH_TOKEN,
  );
}

export function amazonMode() {
  return process.env.AMAZON_MODE === "production" ? "production" : "sandbox";
}

export function amazonConnectorReady() {
  return amazonConfigured()
    && (amazonMode() === "sandbox" || process.env.AMAZON_PRODUCTION_CONFIRMATION === "I_UNDERSTAND");
}

function marketplaceEndpoint(marketplace: (typeof marketplaces)[keyof typeof marketplaces]) {
  return amazonMode() === "sandbox"
    ? marketplace.endpoint.replace("https://", "https://sandbox.")
    : marketplace.endpoint;
}

function resolveMarketplace(marketplaceId: string) {
  const marketplace = marketplaces[marketplaceId as keyof typeof marketplaces];
  if (!marketplace) throw new Error("不支持的 Amazon 站点");
  return marketplace;
}

export function validateListing(listing: AmazonListing) {
  const issues: string[] = [];
  const hasDraftPlaceholder = (value: string) => /待补充|请补充|TODO|REPLACE|占位|确认真实|未经确认/i.test(value);
  if (!listing.sku.trim()) issues.push("SKU 不能为空");
  if (!listing.productType.trim()) issues.push("必须选择 Amazon Product Type");
  if (!listing.title.trim()) issues.push("英文标题不能为空");
  if (hasDraftPlaceholder(listing.title)) issues.push("标题仍包含待补充或占位内容，请替换为真实买家文案");
  if (!listing.brand.trim()) issues.push("品牌不能为空");
  if (listing.bulletPoints.some(hasDraftPlaceholder)) issues.push("五点卖点仍包含待补充或占位内容，请改成真实商品卖点");
  if (!listing.description.trim()) issues.push("商品描述不能为空");
  if (hasDraftPlaceholder(listing.description)) issues.push("商品描述仍包含待补充或占位内容，请改成真实商品描述");
  if (hasDraftPlaceholder(listing.searchTerms)) issues.push("Search Terms 仍包含待补充或占位内容");
  const contentCompliance = validateGeneratedListingCopy({
    title: listing.title,
    bulletPoints: listing.bulletPoints,
    description: listing.description,
    searchTerms: listing.searchTerms,
    competitorInsights: [],
    assumptions: [],
    warnings: [],
  }, listing.productType);
  for (const issue of contentCompliance.issues.filter((item) => item.severity === "error")) {
    if (!issues.includes(issue.message)) issues.push(issue.message);
  }
  if (listing.price <= 0) issues.push("售价必须大于 0");
  if (listing.quantity < 0) issues.push("库存不能小于 0");
  if (!marketplaces[listing.marketplaceId as keyof typeof marketplaces]) issues.push("不支持的 Amazon 站点");
  return issues;
}

function templateScalar(attribute: string, value: string): string | number | boolean {
  const trimmed = value.trim();
  const leaf = attribute.split(".").at(-1)?.replace(/#\d+$/, "") ?? "";
  if (/^(true|false)$/i.test(trimmed) && (leaf.startsWith("is_") || attribute.includes(".is_"))) {
    return trimmed.toLowerCase() === "true";
  }
  if (
    /^-?\d+(?:\.\d+)?$/.test(trimmed)
    && /^(quantity|value_with_tax|lower_bound|lead_time_to_ship_max_days|minimum_order_quantity|maximum_order_quantity)$/.test(leaf)
  ) {
    return Number(trimmed);
  }
  return trimmed;
}

function ensureObjectAt(items: unknown[], index: number) {
  while (items.length <= index) items.push({});
  const current = items[index];
  if (!current || typeof current !== "object" || Array.isArray(current)) items[index] = {};
  return items[index] as Record<string, unknown>;
}

export function amazonTemplateValuesToAttributes(values: Record<string, string>, marketplaceId?: string) {
  const attributes: Record<string, unknown> = {};
  const productIdType = values["amzn1.volt.ca.product_id_type"]?.trim();
  const productIdValue = values["amzn1.volt.ca.product_id_value"]?.trim();
  if (/^ASIN$/i.test(productIdType) && productIdValue) {
    attributes.merchant_suggested_asin = [{
      value: productIdValue,
      ...(marketplaceId ? { marketplace_id: marketplaceId } : {}),
    }];
  } else if (/GTIN\s*Exempt/i.test(productIdType)) {
    attributes.supplier_declared_has_product_identifier_exemption = [{
      value: true,
      ...(marketplaceId ? { marketplace_id: marketplaceId } : {}),
    }];
  } else if (productIdType && productIdValue) {
    attributes.externally_assigned_product_identifier = [{
      type: productIdType.toLowerCase(),
      value: productIdValue,
      ...(marketplaceId ? { marketplace_id: marketplaceId } : {}),
    }];
  }
  for (const [flatAttribute, rawValue] of Object.entries(values)) {
    if (!rawValue?.trim() || flatAttribute.startsWith("::") || flatAttribute.startsWith("amzn1.")) continue;
    const baseMatch = flatAttribute.match(/^([A-Za-z0-9_:-]+)/);
    if (!baseMatch) continue;
    const base = baseMatch[1];
    if (base === "contribution_sku" || base === "product_type") continue;
    let remainder = flatAttribute.slice(base.length);
    const selectors: Record<string, string> = {};
    while (remainder.startsWith("[")) {
      const selector = remainder.match(/^\[([^=\]]+)=([^\]]*)\]/);
      if (!selector) break;
      selectors[selector[1]] = selector[2];
      remainder = remainder.slice(selector[0].length);
    }
    const rootIndexMatch = remainder.match(/^#(\d+)/);
    const rootIndex = Math.max(0, Number(rootIndexMatch?.[1] ?? 1) - 1);
    if (rootIndexMatch) remainder = remainder.slice(rootIndexMatch[0].length);

    const root = Array.isArray(attributes[base]) ? attributes[base] as unknown[] : [];
    attributes[base] = root;
    let current = ensureObjectAt(root, rootIndex);
    Object.assign(current, selectors);

    const tokens = remainder
      .replace(/^\./, "")
      .split(".")
      .filter(Boolean)
      .map((segment) => {
        const match = segment.match(/^([^#]+)(?:#(\d+))?$/);
        return { key: match?.[1] ?? segment, index: match?.[2] ? Number(match[2]) - 1 : undefined };
      });
    if (!tokens.length) {
      current.value = templateScalar(flatAttribute, rawValue);
      continue;
    }
    tokens.forEach((token, index) => {
      const last = index === tokens.length - 1;
      if (token.index !== undefined) {
        const list = Array.isArray(current[token.key]) ? current[token.key] as unknown[] : [];
        current[token.key] = list;
        const item = ensureObjectAt(list, Math.max(0, token.index));
        if (last) item.value = templateScalar(flatAttribute, rawValue);
        current = item;
      } else if (last) {
        current[token.key] = templateScalar(flatAttribute, rawValue);
      } else {
        const child = current[token.key];
        if (!child || typeof child !== "object" || Array.isArray(child)) current[token.key] = {};
        current = current[token.key] as Record<string, unknown>;
      }
    });
  }
  return attributes;
}

export function buildListingsItemPayload(listing: AmazonListing) {
  const coreAttributes: Record<string, unknown> = {
    item_name: [{ value: listing.title, marketplace_id: listing.marketplaceId }],
    brand: [{ value: listing.brand, marketplace_id: listing.marketplaceId }],
    product_description: [{ value: listing.description, marketplace_id: listing.marketplaceId }],
    bullet_point: listing.bulletPoints.filter(Boolean).map((value) => ({ value, marketplace_id: listing.marketplaceId })),
    purchasable_offer: [{
      marketplace_id: listing.marketplaceId,
      audience: "ALL",
      currency: listing.currency,
      our_price: [{ schedule: [{ value_with_tax: listing.price }] }],
    }],
  };
  if (listing.searchTerms.trim()) {
    coreAttributes.generic_keyword = [{ value: listing.searchTerms, marketplace_id: listing.marketplaceId }];
  }
  const categoryAttributes = amazonTemplateValuesToAttributes(listing.templateValues ?? {}, listing.marketplaceId);
  return {
    productType: listing.productType,
    requirements: "LISTING",
    attributes: { ...categoryAttributes, ...coreAttributes },
  };
}

async function getLwaAccessToken() {
  if (lwaTokenCache && lwaTokenCache.expiresAt > Date.now() + 60_000) return lwaTokenCache.token;
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: process.env.AMAZON_REFRESH_TOKEN ?? "",
    client_id: process.env.AMAZON_LWA_CLIENT_ID ?? "",
    client_secret: process.env.AMAZON_LWA_CLIENT_SECRET ?? "",
  });
  const response = await undiciFetch("https://api.amazon.com/auth/o2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
    body: body.toString(),
    dispatcher: amazonDispatcher(),
  });
  const result = await response.json() as {
    access_token?: string;
    expires_in?: number;
    error?: string;
    error_description?: string;
  };
  if (!response.ok || !result.access_token) {
    throw new Error(result.error_description || result.error || "Amazon LWA 授权失败");
  }
  lwaTokenCache = {
    token: result.access_token,
    expiresAt: Date.now() + Math.max(60, result.expires_in ?? 3600) * 1000,
  };
  return result.access_token;
}

function amazonDate() {
  return new Date().toISOString().replace(/[:-]|\.\d{3}/g, "");
}

function amazonErrorMessage(
  result: { errors?: Array<{ code?: string; message?: string; details?: string }> },
  fallback: string,
) {
  return result.errors?.map((error) => error.message || error.details || error.code).filter(Boolean).join("；") || fallback;
}

async function amazonGet<T>(url: string, fallback: string) {
  if (!amazonConnectorReady()) throw new Error("Amazon SP-API 尚未授权或未确认启用");
  const accessToken = await getLwaAccessToken();
  const response = await undiciFetch(url, {
    method: "GET",
    headers: {
      "User-Agent": "HuacaiAmazonStudio/0.1.0 (Language=TypeScript; Platform=Node.js)",
      "x-amz-access-token": accessToken,
      "x-amz-date": amazonDate(),
    },
    dispatcher: amazonDispatcher(),
  });
  const result = await response.json() as T & {
    errors?: Array<{ code?: string; message?: string; details?: string }>;
  };
  if (!response.ok) throw new Error(amazonErrorMessage(result, `${fallback}（${response.status}）`));
  return result;
}

export async function searchAmazonProductTypes(
  marketplaceId: string,
  query: { keywords?: string; itemName?: string; locale?: string } = {},
) {
  const marketplace = resolveMarketplace(marketplaceId);
  const parameters = new URLSearchParams({ marketplaceIds: marketplaceId });
  if (query.keywords?.trim()) parameters.set("keywords", query.keywords.trim());
  if (query.itemName?.trim()) parameters.set("itemName", query.itemName.trim());
  if (query.locale?.trim()) {
    parameters.set("locale", query.locale.trim());
    parameters.set("searchLocale", query.locale.trim());
  }
  const url = `${marketplaceEndpoint(marketplace)}/definitions/2020-09-01/productTypes?${parameters}`;
  const result = await amazonGet<{ productTypes: AmazonProductTypeSummary[] }>(url, "Amazon 类目搜索失败");
  return result.productTypes ?? [];
}

export async function getAmazonProductTypeDefinition(
  marketplaceId: string,
  productType: string,
  options: { locale?: string; parentageLevel?: "NONE" | "CHILD" | "PARENT" } = {},
) {
  const marketplace = resolveMarketplace(marketplaceId);
  const normalizedType = productType.trim().toUpperCase();
  if (!/^[A-Z0-9_]{2,100}$/.test(normalizedType)) throw new Error("Amazon Product Type 格式无效");
  const key = `${marketplaceId}:${normalizedType}:${options.locale ?? ""}:${options.parentageLevel ?? "NONE"}`;
  const cached = productTypeDefinitionCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached;

  const parameters = new URLSearchParams({
    marketplaceIds: marketplaceId,
    requirements: "LISTING",
    requirementsEnforced: "ENFORCED",
    productTypeVersion: "LATEST",
    parentageLevel: options.parentageLevel ?? "NONE",
  });
  if (options.locale?.trim()) parameters.set("locale", options.locale.trim());
  if (process.env.AMAZON_SELLER_ID) parameters.set("sellerId", process.env.AMAZON_SELLER_ID);
  const url = `${marketplaceEndpoint(marketplace)}/definitions/2020-09-01/productTypes/${encodeURIComponent(normalizedType)}?${parameters}`;
  const definition = await amazonGet<AmazonProductTypeDefinition>(url, "Amazon 类目规则获取失败");
  const schemaResponse = await undiciFetch(definition.schema.link.resource, {
    method: definition.schema.link.verb || "GET",
    dispatcher: amazonDispatcher(),
  });
  if (!schemaResponse.ok) throw new Error(`Amazon 类目 Schema 下载失败（${schemaResponse.status}）`);
  const schema = await schemaResponse.json() as AmazonProductTypeSchema;
  const value = { definition, schema, expiresAt: Date.now() + 6 * 60 * 60 * 1000 };
  productTypeDefinitionCache.set(key, value);
  return value;
}

function firstEnum(value: unknown, depth = 0): string[] {
  if (!value || typeof value !== "object" || depth > 5) return [];
  const record = value as Record<string, unknown>;
  if (Array.isArray(record.enum)) {
    return record.enum.filter((item): item is string => typeof item === "string").slice(0, 200);
  }
  for (const child of Object.values(record)) {
    if (Array.isArray(child)) {
      for (const item of child) {
        const found = firstEnum(item, depth + 1);
        if (found.length) return found;
      }
    } else {
      const found = firstEnum(child, depth + 1);
      if (found.length) return found;
    }
  }
  return [];
}

export function summarizeAmazonProductType(
  definition: AmazonProductTypeDefinition,
  schema: AmazonProductTypeSchema,
) {
  const required = new Set(schema.required ?? []);
  const groupByProperty = new Map<string, { name: string; title: string }>();
  for (const [name, group] of Object.entries(definition.propertyGroups ?? {})) {
    for (const propertyName of group.propertyNames ?? []) {
      groupByProperty.set(propertyName, { name, title: group.title || name });
    }
  }
  const fields: AmazonProductTypeFieldSummary[] = Object.entries(schema.properties ?? {}).map(([name, property]) => {
    const group = groupByProperty.get(name);
    return {
      name,
      title: typeof property.title === "string" ? property.title : name,
      description: typeof property.description === "string" ? property.description : "",
      group: group?.name ?? "other",
      groupTitle: group?.title ?? "其他字段",
      required: required.has(name),
      enumValues: firstEnum(property),
      minItems: typeof property.minItems === "number" ? property.minItems : undefined,
      maxItems: typeof property.maxItems === "number" ? property.maxItems : undefined,
    };
  });
  return {
    productType: definition.productType,
    displayName: definition.displayName,
    marketplaceIds: definition.marketplaceIds,
    locale: definition.locale,
    version: definition.productTypeVersion,
    schemaChecksum: definition.schema.checksum,
    fields,
    requiredCount: fields.filter((field) => field.required).length,
  };
}

export async function putListingsItem(listing: AmazonListing, validationPreview = false) {
  if (!amazonConfigured()) throw new Error("Amazon SP-API 尚未授权");
  if (!amazonConnectorReady()) {
    throw new Error("正式环境尚未确认启用，请管理员完成生产发布确认");
  }
  const marketplace = marketplaces[listing.marketplaceId as keyof typeof marketplaces];
  if (!marketplace) throw new Error("不支持的 Amazon 站点");
  const accessToken = await getLwaAccessToken();
  const query = new URLSearchParams({
    marketplaceIds: listing.marketplaceId,
    issueLocale: "en_US",
  });
  if (validationPreview) query.set("mode", "VALIDATION_PREVIEW");
  const url = `${marketplaceEndpoint(marketplace)}/listings/2021-08-01/items/${encodeURIComponent(process.env.AMAZON_SELLER_ID!)}/${encodeURIComponent(listing.sku)}?${query}`;
  const response = await undiciFetch(url, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": "HuacaiAmazonStudio/0.1.0 (Language=TypeScript; Platform=Node.js)",
      "x-amz-access-token": accessToken,
      "x-amz-date": amazonDate(),
    },
    body: JSON.stringify(buildListingsItemPayload(listing)),
    dispatcher: amazonDispatcher(),
  });
  const result = await response.json() as {
    sku?: string;
    status?: string;
    submissionId?: string;
    issues?: Array<{ code?: string; message?: string; severity?: string; attributeNames?: string[] }>;
    errors?: Array<{ code?: string; message?: string; details?: string }>;
  };
  if (!response.ok) {
    const message = result.errors?.map((error) => error.message || error.details || error.code).filter(Boolean).join("；");
    throw new Error(message || `Amazon SP-API 请求失败（${response.status}）`);
  }
  return result;
}

export async function getListingsItem(listing: AmazonListing) {
  if (!amazonConnectorReady()) throw new Error("Amazon SP-API 尚未就绪");
  const marketplace = marketplaces[listing.marketplaceId as keyof typeof marketplaces];
  if (!marketplace) throw new Error("不支持的 Amazon 站点");
  const accessToken = await getLwaAccessToken();
  const query = new URLSearchParams({
    marketplaceIds: listing.marketplaceId,
    includedData: "summaries,issues",
    issueLocale: "en_US",
  });
  const url = `${marketplaceEndpoint(marketplace)}/listings/2021-08-01/items/${encodeURIComponent(process.env.AMAZON_SELLER_ID!)}/${encodeURIComponent(listing.sku)}?${query}`;
  const response = await undiciFetch(url, {
    method: "GET",
    headers: {
      "User-Agent": "HuacaiAmazonStudio/0.1.0 (Language=TypeScript; Platform=Node.js)",
      "x-amz-access-token": accessToken,
      "x-amz-date": amazonDate(),
    },
    dispatcher: amazonDispatcher(),
  });
  const result = await response.json() as {
    sku?: string;
    summaries?: Array<{ status?: string[] }>;
    issues?: Array<{ code?: string; message?: string; severity?: string }>;
    errors?: Array<{ code?: string; message?: string; details?: string }>;
  };
  if (!response.ok) {
    const message = result.errors?.map((error) => error.message || error.details || error.code).filter(Boolean).join("；");
    throw new Error(message || `Amazon 状态查询失败（${response.status}）`);
  }
  return result;
}
