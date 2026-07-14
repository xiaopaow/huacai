import type { DatabaseSchema, WorkspaceProduct } from "./types.js";

const demoProducts = new Map<string, Pick<WorkspaceProduct, "sku" | "name">>([
  ["prd-001", { sku: "HC-HDP-001", name: "无线降噪头戴式耳机" }],
  ["prd-002", { sku: "HC-BTL-018", name: "不锈钢保温水杯 750ml" }],
  ["prd-003", { sku: "HC-LMP-006", name: "充电式露营灯" }],
  ["prd-004", { sku: "HC-BAG-023", name: "轻量通勤托特包" }],
]);
const demoTaskIds = new Set(["TSK-0629-018", "TSK-0629-017", "TSK-0629-016"]);
const demoListingIds = new Set(["lst-001"]);
const demoActivityIds = new Set(["act-seed-1", "act-seed-2", "act-seed-3", "act-seed-4"]);

function isDemoProduct(product: WorkspaceProduct) {
  const signature = demoProducts.get(product.id);
  return Boolean(signature && signature.sku === product.sku && signature.name === product.name);
}

export function getDemoDataStatus(data: DatabaseSchema) {
  const productIds = data.products.filter(isDemoProduct).map((product) => product.id);
  const taskIds = data.tasks.filter((task) => demoTaskIds.has(task.id)).map((task) => task.id);
  const listingIds = data.listings.filter((listing) => demoListingIds.has(listing.id)).map((listing) => listing.id);
  const activityIds = data.activities.filter((activity) => demoActivityIds.has(activity.id)).map((activity) => activity.id);
  return {
    detected: productIds.length + taskIds.length + listingIds.length + activityIds.length > 0,
    productIds,
    taskIds,
    listingIds,
    activityIds,
    productCount: productIds.length,
    taskCount: taskIds.length,
    listingCount: listingIds.length,
    activityCount: activityIds.length,
  };
}

export function removeDemoData(data: DatabaseSchema) {
  const status = getDemoDataStatus(data);
  const productIds = new Set(status.productIds);
  const taskIds = new Set(status.taskIds);
  const listingIds = new Set(status.listingIds);
  const activityIds = new Set(status.activityIds);
  data.products = data.products.filter((product) => !productIds.has(product.id));
  data.tasks = data.tasks.filter((task) => !taskIds.has(task.id));
  data.listings = data.listings.filter((listing) => !listingIds.has(listing.id));
  data.listingGenerations = data.listingGenerations.filter((generation) => !listingIds.has(generation.listingId));
  data.activities = data.activities.filter((activity) => !activityIds.has(activity.id));
  data.notifications = data.notifications.filter((notification) => !productIds.has(notification.entityId) && !taskIds.has(notification.entityId));
  return status;
}
