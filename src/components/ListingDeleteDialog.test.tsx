import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import ListingDeleteDialog from "./ListingDeleteDialog";
import type { AmazonListing } from "../types/domain";

const listing: AmazonListing = {
  id: "listing-1",
  sku: "HC-001",
  marketplaceId: "ATVPDKIKX0DER",
  marketplaceName: "美国站",
  productType: "WALL_ART",
  title: "Wall Art",
  brand: "花彩",
  description: "",
  bulletPoints: [],
  searchTerms: "",
  price: 0,
  currency: "USD",
  quantity: 0,
  status: "草稿",
  ownerId: "employee-1",
  issues: [],
  updatedAt: "2026-07-02",
};

describe("ListingDeleteDialog", () => {
  it("草稿需要二次确认后才删除", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(
      <ListingDeleteDialog
        listing={listing}
        deleting={false}
        onCancel={vi.fn()}
        onConfirm={onConfirm}
      />,
    );

    await user.click(screen.getByRole("button", { name: "确认删除草稿" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("已发布 Listing 必须走 Amazon 下架流程", () => {
    render(
      <ListingDeleteDialog
        listing={{ ...listing, status: "已发布" }}
        deleting={false}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );

    expect(screen.getByText(/必须调用 Amazon 删除\/下架流程/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "确认删除草稿" })).not.toBeInTheDocument();
  });
});
