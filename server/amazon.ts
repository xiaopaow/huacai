import type { AmazonListing } from "./types.js";
import { ProxyAgent, fetch as undiciFetch } from "undici";

let cachedDispatcher: ProxyAgent | undefined;
let lwaTokenCache: { token: string; expiresAt: number } | null = null;

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

export function validateListing(listing: AmazonListing) {
  const issues: string[] = [];
  if (!listing.sku.trim()) issues.push("SKU 不能为空");
  if (!listing.productType.trim()) issues.push("必须选择 Amazon Product Type");
  if (!listing.title.trim()) issues.push("英文标题不能为空");
  if (listing.title.length > 200) issues.push("标题超过通用上限 200 字符，仍需按类目规则复核");
  if (!listing.brand.trim()) issues.push("品牌不能为空");
  if (listing.bulletPoints.filter(Boolean).length < 5) issues.push("建议填写 5 条完整卖点");
  if (listing.bulletPoints.some((point) => point.length > 500)) issues.push("单条卖点不能超过 500 字符");
  if (!listing.description.trim()) issues.push("商品描述不能为空");
  if (listing.price <= 0) issues.push("售价必须大于 0");
  if (listing.quantity < 0) issues.push("库存不能小于 0");
  if (!marketplaces[listing.marketplaceId as keyof typeof marketplaces]) issues.push("不支持的 Amazon 站点");
  return issues;
}

export function buildListingsItemPayload(listing: AmazonListing) {
  return {
    productType: listing.productType,
    requirements: "LISTING",
    attributes: {
      item_name: [{ value: listing.title, marketplace_id: listing.marketplaceId }],
      brand: [{ value: listing.brand, marketplace_id: listing.marketplaceId }],
      product_description: [{ value: listing.description, marketplace_id: listing.marketplaceId }],
      bullet_point: listing.bulletPoints.filter(Boolean).map((value) => ({ value, marketplace_id: listing.marketplaceId })),
      generic_keyword: [{ value: listing.searchTerms, marketplace_id: listing.marketplaceId }],
      list_price: [{ value_with_tax: listing.price, currency: listing.currency, marketplace_id: listing.marketplaceId }],
    },
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
