import type { AmazonListing } from "../types/domain";

export interface ListingComplianceIssue {
  code: string;
  field: "title" | "bulletPoints" | "description" | "searchTerms" | "general";
  severity: "error" | "warning";
  message: string;
  index?: number;
}

export interface ListingComplianceReport {
  titleLimit: number;
  issues: ListingComplianceIssue[];
  compliant: boolean;
}

const mediaProductTypes = new Set([
  "BOOK", "BOOKS", "DVD", "MEDIA", "MOVIE", "MOVIES_TV", "MUSIC", "MUSIC_ALBUM", "PHYSICAL_MUSIC", "SOFTWARE", "VIDEO", "VIDEOS",
]);
const forbiddenTitleCharacters = /[!$?_{}^¬¦]/;
const promotionalPattern = /(?:#\s*1|best\s*seller|best-selling|free\s+shipping|limited\s+time|sale\b|discount|coupon|lowest\s+price|money[- ]back|refund|satisfaction\s+guarantee|guaranteed\s+results?)/i;
const contactPattern = /(?:https?:\/\/|www\.|@[a-z0-9.-]+\.[a-z]{2,}|\b(?:email|e-mail|phone|whatsapp|wechat)\b)/i;
const htmlPattern = /<\/?[a-z][^>]*>/i;
const emojiPattern = /\p{Extended_Pictographic}/u;
const draftPlaceholderPattern = /(?:待补充|请补充|TODO|REPLACE|占位|确认真实|未经确认)/i;
const stopWords = new Set(["a", "an", "and", "as", "at", "by", "for", "from", "in", "of", "on", "or", "the", "to", "with"]);

export function listingTitleLimit(productType: string) {
  const normalized = productType.trim().toUpperCase().replace(/[\s-]+/g, "_");
  return mediaProductTypes.has(normalized) ? 200 : 75;
}

export interface CompetitorUrlReference {
  source: "amazon" | "etsy";
  sourceLabel: "Amazon" | "Etsy";
  idLabel: "ASIN" | "Listing ID";
  id: string;
}

export function extractCompetitorReference(value: string): CompetitorUrlReference | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
    const hostname = url.hostname.toLowerCase().replace(/^www\./, "").replace(/^smile\./, "");
    if (hostname === "etsy.com" || hostname.endsWith(".etsy.com")) {
      const id = url.pathname.match(/\/listing\/(\d{6,20})(?:[/?-]|$)/i)?.[1] ?? "";
      return id ? { source: "etsy", sourceLabel: "Etsy", idLabel: "Listing ID", id } : null;
    }
    if (/^amazon\.[a-z.]+$/.test(hostname) || hostname.includes(".amazon.")) {
      const match = url.pathname.match(/\/(?:dp|gp\/product|gp\/aw\/d|product)\/([A-Z0-9]{10})(?:[/?]|$)/i);
      const id = (match?.[1] || url.searchParams.get("asin")?.match(/^[A-Z0-9]{10}$/i)?.[0] || "").toUpperCase();
      return id ? { source: "amazon", sourceLabel: "Amazon", idLabel: "ASIN", id } : null;
    }
    return null;
  } catch {
    return null;
  }
}

export function extractAmazonAsin(value: string) {
  const reference = extractCompetitorReference(value);
  return reference?.source === "amazon" ? reference.id : "";
}

function repeatedTitleWords(title: string) {
  const counts = new Map<string, number>();
  for (const word of title.toLowerCase().match(/[a-z0-9]+(?:-[a-z0-9]+)*/g) ?? []) {
    if (word.length < 2 || stopWords.has(word)) continue;
    counts.set(word, (counts.get(word) ?? 0) + 1);
  }
  return [...counts.entries()].filter(([, count]) => count > 2).map(([word]) => word);
}

export function buildListingComplianceReport(
  listing: Pick<AmazonListing, "title" | "bulletPoints" | "description" | "searchTerms" | "productType">,
  aiAssumptions: string[] = [],
): ListingComplianceReport {
  const issues: ListingComplianceIssue[] = [];
  const titleLimit = listingTitleLimit(listing.productType);
  const add = (issue: ListingComplianceIssue) => issues.push(issue);
  const title = listing.title.trim();

  if (!title) add({ code: "TITLE_REQUIRED", field: "title", severity: "error", message: "标题不能为空" });
  if (draftPlaceholderPattern.test(title)) add({ code: "TITLE_PLACEHOLDER", field: "title", severity: "error", message: "标题仍包含待补充或占位内容" });
  if (title.length > titleLimit) add({ code: "TITLE_TOO_LONG", field: "title", severity: "error", message: `标题需控制在 ${titleLimit} 个字符以内（当前 ${title.length}）` });
  if (forbiddenTitleCharacters.test(title)) add({ code: "TITLE_FORBIDDEN_CHARACTER", field: "title", severity: "error", message: "标题包含 Amazon 限制的特殊字符" });
  const repeated = repeatedTitleWords(title);
  if (repeated.length) add({ code: "TITLE_REPEATED_WORD", field: "title", severity: "error", message: `标题中的实义词重复超过两次：${repeated.join("、")}` });
  if (promotionalPattern.test(title)) add({ code: "TITLE_PROMOTIONAL", field: "title", severity: "error", message: "标题包含促销、排名或保证类表达" });

  if (listing.bulletPoints.length !== 5) add({ code: "BULLET_COUNT", field: "bulletPoints", severity: "error", message: "五点卖点必须正好 5 条" });
  listing.bulletPoints.forEach((point, index) => {
    const value = point.trim();
    if (!value) add({ code: "BULLET_REQUIRED", field: "bulletPoints", severity: "error", index, message: `第 ${index + 1} 条卖点不能为空` });
    else if (value.length < 10) add({ code: "BULLET_TOO_SHORT", field: "bulletPoints", severity: "warning", index, message: `第 ${index + 1} 条卖点信息较少` });
    if (draftPlaceholderPattern.test(value)) add({ code: "BULLET_PLACEHOLDER", field: "bulletPoints", severity: "error", index, message: `第 ${index + 1} 条卖点仍包含待补充或占位内容` });
    if (value.length > 255) add({ code: "BULLET_TOO_LONG", field: "bulletPoints", severity: "error", index, message: `第 ${index + 1} 条卖点超过 255 个字符` });
    if (emojiPattern.test(value)) add({ code: "BULLET_EMOJI", field: "bulletPoints", severity: "error", index, message: `第 ${index + 1} 条卖点包含 emoji` });
    if (promotionalPattern.test(value)) add({ code: "BULLET_PROMOTIONAL", field: "bulletPoints", severity: "error", index, message: `第 ${index + 1} 条包含促销、退款保证或夸大表达` });
    if (contactPattern.test(value) || htmlPattern.test(value)) add({ code: "BULLET_EXTERNAL_CONTENT", field: "bulletPoints", severity: "error", index, message: `第 ${index + 1} 条包含链接、联系方式或 HTML` });
  });

  if (!listing.description.trim()) add({ code: "DESCRIPTION_REQUIRED", field: "description", severity: "warning", message: "商品描述为空" });
  if (draftPlaceholderPattern.test(listing.description)) add({ code: "DESCRIPTION_PLACEHOLDER", field: "description", severity: "error", message: "商品描述仍包含待补充或占位内容" });
  if (listing.description.length > 2000) add({ code: "DESCRIPTION_TOO_LONG", field: "description", severity: "warning", message: "商品描述超过建议的 2000 个字符" });
  if (htmlPattern.test(listing.description)) add({ code: "DESCRIPTION_HTML", field: "description", severity: "error", message: "商品描述包含 HTML 标签" });
  if (promotionalPattern.test(listing.description) || contactPattern.test(listing.description)) add({ code: "DESCRIPTION_PROMOTIONAL", field: "description", severity: "error", message: "商品描述包含促销保证、外链或联系方式" });

  const searchBytes = new TextEncoder().encode(listing.searchTerms).length;
  if (!listing.searchTerms.trim()) add({ code: "SEARCH_TERMS_REQUIRED", field: "searchTerms", severity: "warning", message: "Search Terms 为空" });
  if (draftPlaceholderPattern.test(listing.searchTerms)) add({ code: "SEARCH_TERMS_PLACEHOLDER", field: "searchTerms", severity: "error", message: "Search Terms 仍包含待补充或占位内容" });
  if (searchBytes > 250) add({ code: "SEARCH_TERMS_TOO_LONG", field: "searchTerms", severity: "error", message: `Search Terms 超过 250 字节（当前 ${searchBytes}）` });
  if (/[,;|]/.test(listing.searchTerms)) add({ code: "SEARCH_TERMS_PUNCTUATION", field: "searchTerms", severity: "warning", message: "Search Terms 建议只用空格分隔" });

  aiAssumptions.forEach((assumption, index) => add({ code: `AI_ASSUMPTION_${index + 1}`, field: "general", severity: "warning", message: `AI 待确认：${assumption}` }));
  return { titleLimit, issues, compliant: !issues.some((issue) => issue.severity === "error") };
}

export function listingClipboardText(listing: Pick<AmazonListing, "title" | "bulletPoints" | "description" | "searchTerms">) {
  return [
    "TITLE",
    listing.title.trim(),
    "",
    "BULLET POINTS",
    ...listing.bulletPoints.map((point, index) => `${index + 1}. ${point.trim()}`),
    "",
    "DESCRIPTION",
    listing.description.trim(),
    "",
    "SEARCH TERMS",
    listing.searchTerms.trim(),
  ].join("\n");
}
