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
        source: "amazon",
        sourceLabel: "Amazon",
        externalId: "B0ABC12345",
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

    const input = await screen.findByRole("textbox", { name: "Amazon 或 Etsy 竞品链接" });
    await user.type(input, "https://www.amazon.com/example/dp/B0ABC12345?th=1");
    expect(screen.getByText("已识别 Amazon ASIN：B0ABC12345")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /AI 生成 Listing/ }));
    await waitFor(() => expect(generateListingCopy).toHaveBeenCalledWith({
      listingId: listing.id,
      generationMode: "competitor_first",
      competitorUrl: "https://www.amazon.com/example/dp/B0ABC12345?th=1",
      productFacts: undefined,
      instructions: undefined,
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

  it("recognizes an Etsy listing link without requiring an API key in the browser", async () => {
    const user = userEvent.setup();
    render(<ListingsPage products={[product]} tasks={[]} notify={vi.fn()} />);
    const input = await screen.findByRole("textbox", { name: "Amazon 或 Etsy 竞品链接" });
    await user.type(input, "https://www.etsy.com/listing/1803640494/example-product");
    expect(screen.getByText("已识别 Etsy Listing ID：1803640494")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /AI 生成 Listing/ })).toBeEnabled();
  });

  it("does not call AI until a valid Amazon or Etsy product link is present", async () => {
    const user = userEvent.setup();
    render(<ListingsPage products={[product]} tasks={[]} notify={vi.fn()} />);
    const input = await screen.findByRole("textbox", { name: "Amazon 或 Etsy 竞品链接" });
    await user.type(input, "https://example.com/product/123");
    expect(screen.getByRole("button", { name: /AI 生成 Listing/ })).toBeDisabled();
    expect(generateListingCopy).not.toHaveBeenCalled();
  });

  it("generates from verified product facts without a competitor link", async () => {
    const user = userEvent.setup();
    vi.mocked(generateListingCopy).mockResolvedValueOnce({
      generationId: "generation-facts-1",
      version: 2,
      copy: {
        title: "FLORA Solid Wood Two-Tier Synthesizer Stand",
        bulletPoints: [
          "Two-tier structure organizes compact synthesizers",
          "Solid wood construction with rounded edges",
          "Angled design supports a comfortable workflow",
          "Non-slip pads help keep equipment stable",
          "Designed for compact Volca-style synthesizers",
        ],
        description: "A solid wood two-tier stand for organizing compact synthesizers.",
        searchTerms: "wood synthesizer stand two tier desktop organizer",
        competitorInsights: [],
        assumptions: [],
        warnings: [],
      },
      compliance: { titleLimit: 75, issues: [], compliant: true },
      model: "openai/gpt-5.4",
      generationMode: "product_facts",
    });

    render(<ListingsPage products={[product]} tasks={[]} notify={vi.fn()} />);
    await user.click(await screen.findByRole("tab", { name: "商品资料生成" }));

    const facts = screen.getByRole("textbox", { name: "已核实商品资料" });
    await user.clear(facts);
    await user.type(facts, [
      "商品名称：双层合成器支架",
      "品牌：FLORA",
      "商品类型：桌面合成器支架",
      "材质与结构：实木，双层结构，圆角打磨",
      "尺寸/重量：适配 Volca 系列小型合成器",
      "核心功能与卖点：节省桌面空间，防滑垫，螺丝固定结构",
    ].join("\n"));

    await user.click(screen.getByRole("button", { name: /AI 生成 Listing/ }));
    await waitFor(() => expect(generateListingCopy).toHaveBeenCalledWith(expect.objectContaining({
      listingId: listing.id,
      generationMode: "product_facts",
      productFacts: expect.stringContaining("双层合成器支架"),
    })));
    expect(await screen.findByDisplayValue("FLORA Solid Wood Two-Tier Synthesizer Stand")).toBeInTheDocument();
    expect(screen.getByText(/商品资料读取成功/)).toBeInTheDocument();
  });
});
