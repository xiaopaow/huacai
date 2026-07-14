import { describe, expect, it } from "vitest";
import { getDemoDataStatus, removeDemoData } from "./demoData.js";
import type { DatabaseSchema } from "./types.js";

function database(): DatabaseSchema {
  return {
    employees: [],
    sessions: [],
    generatedAssets: [],
    uploadedAssets: [],
    imageJobs: [],
    notifications: [],
    activities: [
      { id: "act-seed-1", employeeId: "admin", type: "SKU_CREATED", entityType: "product", entityId: "prd-001", quantity: 1, createdAt: "" },
      { id: "real-activity", employeeId: "admin", type: "SKU_CREATED", entityType: "product", entityId: "real-product", quantity: 1, createdAt: "" },
    ],
    listings: [{
      id: "lst-001", sku: "HC-HDP-001", marketplaceId: "US", marketplaceName: "美国站", productType: "HEADPHONES",
      title: "Demo", brand: "FLORA", description: "", bulletPoints: [], searchTerms: "", price: 1, currency: "USD",
      quantity: 1, status: "草稿", ownerId: "admin", issues: [], updatedAt: "",
    }],
    listingGenerations: [],
    products: [
      { id: "prd-001", sku: "HC-HDP-001", name: "无线降噪头戴式耳机", brand: "FLORA", category: "Electronics", marketplace: "美国站", status: "生产中", imageCount: 0, updatedAt: "" },
      { id: "real-product", sku: "COMPANY-001", name: "公司商品", brand: "公司品牌", category: "Home", marketplace: "美国站", status: "可生成", imageCount: 0, updatedAt: "" },
    ],
    tasks: [
      { id: "TSK-0629-018", productId: "prd-001", sku: "HC-HDP-001", productName: "无线降噪头戴式耳机", type: "Amazon 六图套图", status: "生成中", progress: 50, owner: "Admin", updatedAt: "" },
      { id: "real-task", productId: "real-product", sku: "COMPANY-001", productName: "公司商品", type: "场景图", status: "待生成", progress: 0, owner: "Admin", updatedAt: "" },
    ],
  };
}

describe("演示数据清理", () => {
  it("只识别签名完全匹配的演示数据", () => {
    const data = database();
    data.products.push({ ...data.products[0], id: "prd-002", name: "已改成公司商品" });

    const status = getDemoDataStatus(data);
    expect(status).toMatchObject({ detected: true, productCount: 1, taskCount: 1, listingCount: 1, activityCount: 1 });
    expect(status.productIds).not.toContain("prd-002");
  });

  it("清理演示记录并保留公司真实数据", () => {
    const data = database();
    removeDemoData(data);

    expect(data.products.map((item) => item.id)).toEqual(["real-product"]);
    expect(data.tasks.map((item) => item.id)).toEqual(["real-task"]);
    expect(data.activities.map((item) => item.id)).toEqual(["real-activity"]);
    expect(data.listings).toEqual([]);
  });
});
