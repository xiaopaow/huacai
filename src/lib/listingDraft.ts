import type { AmazonListing, Product } from "../types/domain";

interface ListingDraftMarketplace {
  id: string;
  name: string;
  currency: string;
}

export interface ListingDraftCopy {
  title: string;
  brand: string;
  description: string;
  bulletPoints: string[];
  searchTerms: string;
}

function clean(value: unknown) {
  return String(value ?? "").trim().replace(/\s+/g, " ");
}

function truncate(value: string, maxLength: number) {
  return value.length > maxLength ? value.slice(0, maxLength - 1).trimEnd() : value;
}

function uniqueWords(values: string[]) {
  const seen = new Set<string>();
  const words: string[] = [];
  for (const value of values) {
    for (const word of value.toLowerCase().match(/[a-z0-9][a-z0-9-]{1,}/g) ?? []) {
      if (seen.has(word)) continue;
      seen.add(word);
      words.push(word);
    }
  }
  return words;
}

export function buildListingDraftCopyFromProduct(
  product: Pick<Product, "sku" | "asin" | "name" | "brand" | "category" | "marketplace">,
  marketplaceName?: string,
): ListingDraftCopy {
  const sku = clean(product.sku);
  const name = clean(product.name);
  const brand = clean(product.brand);
  const category = clean(product.category);
  const marketplace = clean(marketplaceName || product.marketplace);
  const categoryInName = category && name.toLowerCase().includes(category.toLowerCase());
  const titleParts = [brand, name, categoryInName ? "" : category].filter(Boolean);
  const title = truncate(titleParts.join(" "), 200) || sku;
  const productLabel = [brand, name].filter(Boolean).join(" ") || sku || "该商品";
  const categoryLabel = category || "当前类目";
  const marketplaceLabel = marketplace || "目标站点";
  const keywords = uniqueWords([brand, name, category, sku]).slice(0, 20).join(" ");

  return {
    title,
    brand,
    bulletPoints: [
      `待补充：说明 ${productLabel} 的核心卖点、目标买家和主要使用场景。`,
      `待补充：确认 ${categoryLabel} 相关的材质、尺寸、颜色、包装数量等真实规格。`,
      `待补充：补充安装、清洁、收纳、维护或使用注意事项，避免买家误解。`,
      `待补充：写清适用于 ${marketplaceLabel} 买家的差异化优势、礼品场景或搭配建议。`,
      "待补充：检查所有承诺都有商品资料或图片支持，不写未经确认的功效、认证或保修。",
    ],
    description: `待补充：基于 ${productLabel} 的真实规格、包装内容、使用场景和售后说明，整理成适合 ${marketplaceLabel} 的 Amazon 商品描述。`,
    searchTerms: keywords,
  };
}

export function buildListingCreateInputFromProduct(
  product: Product,
  marketplace: ListingDraftMarketplace,
): Partial<AmazonListing> {
  const copy = buildListingDraftCopyFromProduct(product, marketplace.name);
  return {
    sku: product.sku,
    asin: product.asin,
    title: copy.title,
    brand: copy.brand,
    marketplaceId: marketplace.id,
    marketplaceName: marketplace.name,
    productType: "",
    currency: marketplace.currency,
    bulletPoints: copy.bulletPoints,
    description: copy.description,
    searchTerms: copy.searchTerms,
  };
}

function shouldFill(value: string | number | undefined, overwrite: boolean) {
  if (overwrite) return true;
  return String(value ?? "").trim().length === 0;
}

export function mergeListingDraftCopyFromProduct(
  listing: AmazonListing,
  product: Product,
  options: { marketplaceName?: string; overwrite?: boolean } = {},
) {
  const copy = buildListingDraftCopyFromProduct(product, options.marketplaceName || listing.marketplaceName);
  const overwrite = Boolean(options.overwrite);
  return {
    ...listing,
    asin: shouldFill(listing.asin, overwrite) ? product.asin : listing.asin,
    title: shouldFill(listing.title, overwrite) ? copy.title : listing.title,
    brand: shouldFill(listing.brand, overwrite) ? copy.brand : listing.brand,
    description: shouldFill(listing.description, overwrite) ? copy.description : listing.description,
    searchTerms: shouldFill(listing.searchTerms, overwrite) ? copy.searchTerms : listing.searchTerms,
    bulletPoints: Array.from({ length: Math.max(5, listing.bulletPoints.length, copy.bulletPoints.length) }, (_, index) => {
      const current = listing.bulletPoints[index] ?? "";
      return shouldFill(current, overwrite) ? (copy.bulletPoints[index] ?? current) : current;
    }).slice(0, 5),
  };
}
