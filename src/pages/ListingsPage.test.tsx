import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ListingsPage from "./ListingsPage";
import { generateListingCopy, getListings, updateListing } from "../lib/api";
import type { AmazonListing, Product } from "../types/domain";

vi.mock("../lib/api", () => ({
  ApiError: class ApiError extends Error {
    code?: string;
    data: Record<string, unknown> = {};
  },
  createListing: vi.fn(),
  generateListingCopy: vi.fn(),
  getListings: vi.fn(),
  updateListing: vi.fn(),
}));

const listing: AmazonListing = {
  id: "listing-1",
  sku: "HC-WA-001",
  marketplaceId: "ATVPDKIKX0DER",
  marketplaceName: "美国站",
  productType: "WALL_ART",
  title: "Old Wall Art Title",
  brand: "FLORA",
  description: "Old description",
  bulletPoints: ["Old point one", "Old point two", "Old point three", "Old point four", "Old point five"],
  searchTerms: "old wall art",
  price: 29.99,
  currency: "USD",
  quantity: 10,
  status: "待完善",
  ownerId: "employee-1",
  issues: [],
  updatedAt: "2026-07-12T00:00:00.000Z",
};

const product: Product = {
  id: "product-1",
  sku: listing.sku,
  name: "Neutral Canvas Wall Art",
  brand: "FLORA",
  category: "WALL_ART",
  marketplace: "美国站",
  status: "可生成",
  imageCount: 3,
  updatedAt: "2026-07-12T00:00:00.000Z",
};

describe("ListingsPage AI workflow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getListings).mockResolvedValue([listing]);
    vi.mocked(generateListingCopy).mockResolvedValue({
      generationId: "generation-1",
      version: 1,
      copy: {
        title: "FLORA Neutral Canvas Wall Art for Modern Living Rooms",
        bulletPoints: [
          "Neutral tones complement calm modern interiors",
          "Canvas wall decor suited to living rooms and bedrooms",
          "Balanced composition pairs with natural furnishings",
          "Simple palette works across modern home decor styles",
          "Review product dimensions before choosing a display space",
        ],
        description: "Neutral canvas wall art created for modern living spaces.",
        searchTerms: "neutral canvas wall art modern home decor",
        competitorInsights: ["Competitor emphasizes neutral styling"],
        assumptions: [],
        warnings: [],
      },
      compliance: { titleLimit: 75, issues: [], compliant: true },
      model: "openai/gpt-5.4",
      generationMode: "competitor_first",
      competitor: {
        asin: "B0ABC12345",
        marketplace: "美国站",
        canonicalUrl: "https://www.amazon.com/dp/B0ABC12345",
        sourceStatus: "fetched",
        extractedTitle: "Competitor Neutral Wall Art",
        manualContentUsed: false,
      },
    });
    vi.mocked(updateListing).mockImplementation(async (value) => ({ ...value, updatedAt: "2026-07-12T01:00:00.000Z" }));
  });

  it("extracts ASIN, generates content, checks rules and saves only after confirmation", async () => {
    const user = userEvent.setup();
    render(<ListingsPage products={[product]} tasks={[]} notify={vi.fn()} />);

    const input = await screen.findByRole("textbox", { name: "Amazon 竞品链接" });
    await user.type(input, "https://www.amazon.com/example/dp/B0ABC12345?th=1");
    expect(screen.getByText("已识别 ASIN：B0ABC12345")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /AI 生成 Listing/ }));
    await waitFor(() => expect(generateListingCopy).toHaveBeenCalledWith({
      listingId: listing.id,
      competitorUrl: "https://www.amazon.com/example/dp/B0ABC12345?th=1",
    }));

    expect(await screen.findByDisplayValue("FLORA Neutral Canvas Wall Art for Modern Living Rooms")).toBeInTheDocument();
    expect(screen.getByText("规则检查通过")).toBeInTheDocument();
    expect(screen.getByText("● 有未保存修改")).toBeInTheDocument();
    expect(updateListing).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: /保存到 Listing 草稿/ }));
    await waitFor(() => expect(updateListing).toHaveBeenCalledWith(expect.objectContaining({
      title: "FLORA Neutral Canvas Wall Art for Modern Living Rooms",
      competitorAsin: "B0ABC12345",
      competitorUrl: "https://www.amazon.com/dp/B0ABC12345",
    })));
    expect(await screen.findByText("✓ 草稿已保存")).toBeInTheDocument();
  });

  it("does not call AI until a valid Amazon product link is present", async () => {
    const user = userEvent.setup();
    render(<ListingsPage products={[product]} tasks={[]} notify={vi.fn()} />);
    const input = await screen.findByRole("textbox", { name: "Amazon 竞品链接" });
    await user.type(input, "https://example.com/product/123");
    expect(screen.getByRole("button", { name: /AI 生成 Listing/ })).toBeDisabled();
    expect(generateListingCopy).not.toHaveBeenCalled();
  });
});
