import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import ProductDeleteDialog from "./ProductDeleteDialog";
import type { Product } from "../types/domain";

const product: Product = {
  id: "product-1",
  sku: "HC-CUP-001",
  name: "不锈钢保温杯",
  brand: "花彩",
  category: "Home & Kitchen",
  marketplace: "美国站",
  status: "可生成",
  imageCount: 3,
  updatedAt: "2026-07-02",
};

describe("ProductDeleteDialog", () => {
  it("关联任务存在时阻止删除并解释原因", async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    const onConfirm = vi.fn();
    render(
      <ProductDeleteDialog
        product={product}
        relatedTaskCount={2}
        relatedListingCount={0}
        deleting={false}
        onCancel={onCancel}
        onConfirm={onConfirm}
      />,
    );

    expect(screen.getByRole("dialog", { name: "这个 SKU 暂时不能删除" })).toBeInTheDocument();
    expect(screen.getByText(/关联了 2 个生产任务/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /确认删除/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "返回商品库" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("关联 Listing 存在时阻止删除并解释原因", () => {
    const onConfirm = vi.fn();
    render(
      <ProductDeleteDialog
        product={product}
        relatedTaskCount={0}
        relatedListingCount={1}
        deleting={false}
        onCancel={vi.fn()}
        onConfirm={onConfirm}
      />,
    );

    expect(screen.getByRole("dialog", { name: "这个 SKU 暂时不能删除" })).toBeInTheDocument();
    expect(screen.getByText(/关联了 1 条 Amazon Listing/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /确认删除/ })).not.toBeInTheDocument();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("无关联任务时需要明确二次确认", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(
      <ProductDeleteDialog
        product={product}
        relatedTaskCount={0}
        relatedListingCount={0}
        deleting={false}
        onCancel={vi.fn()}
        onConfirm={onConfirm}
      />,
    );

    expect(onConfirm).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: `确认删除 ${product.sku}` }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});
