import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import ListingCreateDialog from "./ListingCreateDialog";
import type { AmazonListing, Product } from "../types/domain";

const products: Product[] = [
  {
    id: "product-1",
    sku: "HC-001",
    name: "已有商品",
    brand: "花彩",
    category: "Wall Art",
    marketplace: "美国站",
    status: "可生成",
    imageCount: 1,
    updatedAt: "2026-07-02",
  },
  {
    id: "product-2",
    sku: "HC-002",
    name: "新商品",
    brand: "花彩",
    category: "Wall Art",
    marketplace: "美国站",
    status: "可生成",
    imageCount: 2,
    updatedAt: "2026-07-02",
  },
];

const existing: AmazonListing = {
  id: "listing-1",
  sku: "HC-001",
  marketplaceId: "ATVPDKIKX0DER",
  marketplaceName: "美国站",
  productType: "WALL_ART",
  title: "已有商品",
  brand: "花彩",
  description: "",
  bulletPoints: [],
  searchTerms: "",
  price: 0,
  currency: "USD",
  quantity: 0,
  status: "待完善",
  ownerId: "employee-1",
  issues: [],
  updatedAt: "2026-07-02",
};

describe("ListingCreateDialog", () => {
  it("禁用同站点已有 Listing 的 SKU，并使用可用 SKU 创建", async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn().mockResolvedValue(undefined);
    render(
      <ListingCreateDialog
        products={products}
        listings={[existing]}
        creating={false}
        onClose={vi.fn()}
        onCreate={onCreate}
      />,
    );

    expect(screen.getByRole("option", { name: /HC-001.*已有 Listing/ })).toBeDisabled();
    await waitFor(() => expect(screen.getByRole("combobox", { name: "SKU 商品" })).toHaveValue("product-2"));
    await user.click(screen.getByRole("button", { name: "创建 美国站 Listing" }));

    expect(onCreate).toHaveBeenCalledWith(
      products[1],
      expect.objectContaining({ id: "ATVPDKIKX0DER", name: "美国站", currency: "USD" }),
    );
  });
});
