import { describe, expect, it } from "vitest";
import { publicListingForEmployee } from "./listingVisibility.js";
import type { AmazonListing } from "./types.js";

const listing: AmazonListing = {
  id: "listing-1",
  sku: "SKU-1",
  marketplaceId: "US",
  marketplaceName: "美国站",
  productType: "WALL_ART",
  title: "Title",
  brand: "FLORA",
  description: "Description",
  bulletPoints: ["1", "2", "3", "4", "5"],
  searchTerms: "terms",
  price: 1,
  currency: "USD",
  quantity: 1,
  status: "草稿",
  ownerId: "ops-1",
  ownerName: "运营甲",
  lastEditedById: "ops-2",
  lastEditedByName: "运营乙",
  issues: [],
  updatedAt: "2026-07-13T00:00:00.000Z",
};

describe("Listing 创建人隐私", () => {
  it("管理员看到完整归属", () => {
    expect(publicListingForEmployee(listing, { id: "admin", role: "管理员" }).ownerName).toBe("运营甲");
  });

  it("普通员工只看到自己的身份，其他人显示团队成员", () => {
    const ownerView = publicListingForEmployee(listing, { id: "ops-1", role: "运营" });
    expect(ownerView.ownerName).toBe("运营甲");
    expect(ownerView.lastEditedByName).toBe("团队成员");
    const peerView = publicListingForEmployee(listing, { id: "ops-3", role: "运营" });
    expect(peerView.ownerName).toBe("团队成员");
  });
});
