import type { AmazonListing, WorkspaceProduct, WorkspaceTask } from "./types.js";

const allowedMarketplaces = new Set(["美国站", "英国站", "德国站", "日本站"]);
const allowedStatuses = new Set(["资料待完善", "可生成", "生产中", "已交付"]);

export function normalizeProductInput(
  input: WorkspaceProduct,
  id: string,
): { product?: WorkspaceProduct; error?: string } {
  const sku = String(input.sku ?? "").trim();
  const name = String(input.name ?? "").trim();
  const brand = String(input.brand ?? "").trim();
  const category = String(input.category ?? "").trim() || "未分类";
  const marketplace = String(input.marketplace ?? "").trim() || "美国站";
  const asin = input.asin ? String(input.asin).trim().toUpperCase() : undefined;
  const status = String(input.status ?? "").trim() || "资料待完善";

  if (!sku || !name || !brand) return { error: "SKU、商品名称和品牌为必填项" };
  if (!allowedMarketplaces.has(marketplace)) return { error: "目标站点不受支持" };
  if (asin && !/^[A-Z0-9]{10}$/.test(asin)) return { error: "ASIN 应为 10 位字母或数字" };
  if (!allowedStatuses.has(status)) return { error: "商品状态无效" };

  return {
    product: {
      id,
      sku,
      asin,
      name,
      brand,
      category,
      marketplace,
      status,
      imageCount: Math.max(0, Math.floor(Number(input.imageCount) || 0)),
      updatedAt: String(input.updatedAt || "刚刚"),
    },
  };
}

export function productDeletionBlockReason(
  product: Pick<WorkspaceProduct, "id" | "sku">,
  tasks: Pick<WorkspaceTask, "productId">[],
  listings: Pick<AmazonListing, "sku">[],
) {
  if (tasks.some((task) => task.productId === product.id)) {
    return "该商品已有生产任务，不能直接删除";
  }
  if (listings.some((listing) => listing.sku.toLowerCase() === product.sku.toLowerCase())) {
    return "该商品已有 Amazon Listing，不能直接删除；请先处理 Listing 草稿或提交记录";
  }
  return null;
}
