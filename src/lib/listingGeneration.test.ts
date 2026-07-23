import { describe, expect, it } from "vitest";
import {
  buildListingComplianceReport,
  extractAmazonAsin,
  extractCompetitorReference,
  listingClipboardText,
  listingTitleLimit,
} from "./listingGeneration";

const listing = {
  productType: "WALL_ART",
  title: "FLORA Neutral Canvas Wall Art for Living Room",
  bulletPoints: [
    "Neutral palette designed for calm modern interiors",
    "Canvas wall decor for living rooms and bedrooms",
    "Balanced composition complements natural furnishings",
    "Simple styling works with modern home decor",
    "Review dimensions and package contents before purchase",
  ],
  description: "Neutral canvas wall art designed for modern living spaces.",
  searchTerms: "neutral canvas wall art modern home decor",
};

describe("listing generation helpers", () => {
  it("extracts an ASIN from a single Amazon product link", () => {
    expect(extractAmazonAsin("https://www.amazon.com/example/dp/B0ABC12345?th=1")).toBe("B0ABC12345");
    expect(extractAmazonAsin("https://example.com/dp/B0ABC12345")).toBe("");
  });

  it("recognizes an Etsy listing link", () => {
    expect(extractCompetitorReference("https://www.etsy.com/listing/1803640494/example-product?ref=shop_home_active_1")).toEqual({
      source: "etsy",
      sourceLabel: "Etsy",
      idLabel: "Listing ID",
      id: "1803640494",
    });
  });

  it("uses the 2026 non-media title limit", () => {
    expect(listingTitleLimit("WALL_ART")).toBe(75);
    expect(listingTitleLimit("BOOKS")).toBe(200);
    expect(listingTitleLimit("VIDEO_PROJECTOR")).toBe(75);
  });

  it("reports a compliant draft and formats all content for copying", () => {
    expect(buildListingComplianceReport(listing).compliant).toBe(true);
    expect(listingClipboardText(listing)).toContain("BULLET POINTS\n1. Neutral palette");
  });
});
