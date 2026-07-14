import type { AmazonListing, ListingStatus } from "./types.js";

function normalizedSku(value: string) {
  return value.trim().toUpperCase();
}

export function findListingConflict(
  listings: AmazonListing[],
  candidate: Pick<AmazonListing, "sku" | "marketplaceId">,
  excludeId?: string,
) {
  const sku = normalizedSku(candidate.sku);
  if (!sku) return undefined;
  return listings.find((listing) => (
    listing.id !== excludeId
    && normalizedSku(listing.sku) === sku
    && listing.marketplaceId === candidate.marketplaceId
  ));
}

export function canDeleteLocalListing(status: ListingStatus) {
  return status !== "提交中" && status !== "已发布";
}

function listingGroupKey(listing: Pick<AmazonListing, "sku" | "marketplaceId">) {
  const sku = normalizedSku(listing.sku);
  return sku ? `${sku}::${listing.marketplaceId}` : undefined;
}

function newerFirst(a: AmazonListing, b: AmazonListing) {
  return b.updatedAt.localeCompare(a.updatedAt);
}

export function dedupeLocalListingDrafts(listings: AmazonListing[]) {
  const groups = new Map<string, AmazonListing[]>();
  for (const listing of listings) {
    const key = listingGroupKey(listing);
    if (!key) continue;
    groups.set(key, [...(groups.get(key) ?? []), listing]);
  }

  const removedIds = new Set<string>();
  const removed: AmazonListing[] = [];
  for (const group of groups.values()) {
    if (group.length <= 1) continue;
    const locked = group.filter((listing) => !canDeleteLocalListing(listing.status));
    const removable = group.filter((listing) => canDeleteLocalListing(listing.status));
    const keep = locked.length
      ? new Set(locked.map((listing) => listing.id))
      : new Set([[...removable].sort(newerFirst)[0]?.id].filter(Boolean));

    for (const listing of removable) {
      if (keep.has(listing.id)) continue;
      removedIds.add(listing.id);
      removed.push(listing);
    }
  }

  return {
    listings: listings.filter((listing) => !removedIds.has(listing.id)),
    removed,
  };
}
