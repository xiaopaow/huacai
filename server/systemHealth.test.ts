import { describe, expect, it } from "vitest";
import { buildSystemHealthReport, rollupHealth } from "./systemHealth.js";
import type { DatabaseSchema } from "./types.js";

const activeAdmin = {
  id: "admin",
  username: "admin",
  passwordHash: "hash",
  name: "管理员",
  department: "运营",
  role: "管理员" as const,
  active: true,
  mustChangePassword: false,
};

const baseData: DatabaseSchema = {
  employees: [activeAdmin],
  sessions: [],
  activities: [],
  listings: [],
  listingGenerations: [],
  generatedAssets: [],
  uploadedAssets: [],
  products: [],
  tasks: [],
  imageJobs: [],
  notifications: [],
};

const readyTeam = [
  activeAdmin,
  {
    ...activeAdmin,
    id: "ops",
    username: "ops",
    role: "运营" as const,
  },
  {
    ...activeAdmin,
    id: "designer",
    username: "designer",
    role: "设计" as const,
  },
  {
    ...activeAdmin,
    id: "reviewer",
    username: "reviewer",
    role: "审核" as const,
  },
];

const workflowTask = (overrides = {}) => ({
  id: "TSK-001",
  productId: "product-1",
  sku: "SKU-1",
  productName: "测试商品",
  type: "Amazon 六图套图",
  status: "待生成",
  progress: 0,
  owner: "林晓",
  assignedToId: "designer",
  assignedToName: "林晓",
  updatedAt: "刚刚",
  ...overrides,
});

describe("system health", () => {
  it("rolls up the most severe status", () => {
    expect(rollupHealth([{ status: "ok" }, { status: "warning" }])).toBe("warning");
    expect(rollupHealth([{ status: "warning" }, { status: "error" }])).toBe("error");
    expect(rollupHealth([{ status: "ok" }, { status: "ok" }])).toBe("ok");
  });

  it("warns when initial passwords are still weak defaults", () => {
    const report = buildSystemHealthReport({
      data: {
        ...baseData,
        employees: [{ ...activeAdmin, mustChangePassword: true }],
      },
      databaseFileReady: true,
      uploadDirectoryReady: true,
      backupDirectoryReady: true,
      backupCount: 1,
      backupRetention: 14,
      openAiConfigured: true,
      openAiLastFailure: null,
      amazonConfigured: true,
      amazonConnectorReady: true,
      amazonMode: "sandbox",
      initialAdminPasswordConfigured: false,
      initialAdminPasswordUsesDefault: true,
      initialEmployeePasswordUsesDefault: true,
      apiPort: 8787,
      nodeVersion: "v22.0.0",
    });

    const security = report.items.find((item) => item.key === "security");
    expect(security?.status).toBe("warning");
    expect(security?.action).toContain(".env.local");
  });

  it("warns when the internal workflow lacks active role coverage", () => {
    const report = buildSystemHealthReport({
      data: baseData,
      databaseFileReady: true,
      uploadDirectoryReady: true,
      backupDirectoryReady: true,
      backupCount: 1,
      backupRetention: 14,
      openAiConfigured: true,
      openAiLastFailure: null,
      amazonConfigured: true,
      amazonConnectorReady: true,
      amazonMode: "sandbox",
      initialAdminPasswordConfigured: true,
      initialAdminPasswordUsesDefault: false,
      initialEmployeePasswordUsesDefault: false,
      apiPort: 8787,
      nodeVersion: "v22.0.0",
    });

    const roles = report.items.find((item) => item.key === "team-roles");
    expect(roles?.status).toBe("warning");
    expect(roles?.action).toContain("运营、设计、审核");
  });

  it("warns when demo data is still mixed into the production workspace", () => {
    const report = buildSystemHealthReport({
      data: {
        ...baseData,
        employees: readyTeam,
      },
      demoData: {
        detected: true,
        productCount: 3,
        taskCount: 2,
        listingCount: 1,
        activityCount: 4,
      },
      databaseFileReady: true,
      uploadDirectoryReady: true,
      backupDirectoryReady: true,
      backupCount: 1,
      backupRetention: 14,
      openAiConfigured: true,
      openAiLastFailure: null,
      amazonConfigured: true,
      amazonConnectorReady: true,
      amazonMode: "sandbox",
      initialAdminPasswordConfigured: true,
      initialAdminPasswordUsesDefault: false,
      initialEmployeePasswordUsesDefault: false,
      apiPort: 8787,
      nodeVersion: "v22.0.0",
    });

    const demo = report.items.find((item) => item.key === "demo-data");
    expect(demo?.status).toBe("warning");
    expect(demo?.detail).toContain("3 个 SKU");
    expect(demo?.action).toContain("清理演示数据");
  });

  it("warns when unfinished tasks are unassigned or assigned to inactive people", () => {
    const report = buildSystemHealthReport({
      data: {
        ...baseData,
        employees: readyTeam,
        tasks: [
          workflowTask({ id: "assigned-ok" }),
          workflowTask({ id: "unassigned", assignedToId: undefined, assignedToName: "待分配" }),
          workflowTask({ id: "inactive-assignee", assignedToId: "inactive-designer" }),
          workflowTask({ id: "finished-invalid", status: "已通过", assignedToId: "inactive-designer" }),
        ],
      },
      databaseFileReady: true,
      uploadDirectoryReady: true,
      backupDirectoryReady: true,
      backupCount: 1,
      backupRetention: 14,
      openAiConfigured: true,
      openAiLastFailure: null,
      amazonConfigured: true,
      amazonConnectorReady: true,
      amazonMode: "sandbox",
      initialAdminPasswordConfigured: true,
      initialAdminPasswordUsesDefault: false,
      initialEmployeePasswordUsesDefault: false,
      apiPort: 8787,
      nodeVersion: "v22.0.0",
    });

    const routing = report.items.find((item) => item.key === "task-routing");
    expect(routing?.status).toBe("warning");
    expect(routing?.detail).toContain("2 个未完成任务");
    expect(routing?.detail).toContain("1 个待分配");
    expect(routing?.detail).toContain("1 个负责人已停用或角色无效");
    expect(routing?.action).toContain("重新分配负责人");
  });

  it("warns when task, listing, and asset records lose SKU traceability", () => {
    const report = buildSystemHealthReport({
      data: {
        ...baseData,
        employees: readyTeam,
        products: [
          {
            id: "p1",
            sku: "SKU-1",
            name: "测试商品",
            brand: "花彩",
            category: "墙画",
            marketplace: "美国站",
            status: "Active",
            imageCount: 0,
            updatedAt: "2026-01-01T00:00:00.000Z",
          },
          {
            id: "p2",
            sku: "SKU-2",
            name: "备用商品",
            brand: "花彩",
            category: "墙画",
            marketplace: "美国站",
            status: "Active",
            imageCount: 0,
            updatedAt: "2026-01-01T00:00:00.000Z",
          },
        ],
        tasks: [
          workflowTask({ id: "task-ok", productId: "p1", sku: "SKU-1" }),
          workflowTask({ id: "task-missing-product", productId: "missing-product", sku: "SKU-MISSING" }),
          workflowTask({ id: "task-sku-mismatch", productId: "p1", sku: "SKU-WRONG" }),
          workflowTask({ id: "task-missing-asset", productId: "p1", sku: "SKU-1", inputAssetIds: ["ghost-asset"] }),
        ],
        listings: [
          {
            id: "listing-missing-sku",
            sku: "SKU-MISSING",
            marketplaceId: "ATVPDKIKX0DER",
            marketplaceName: "美国站",
            productType: "WALL_ART",
            title: "Wall Art",
            brand: "Huacai",
            description: "desc",
            bulletPoints: ["a", "b", "c", "d", "e"],
            searchTerms: "wall art",
            price: 10,
            currency: "USD",
            quantity: 1,
            status: "草稿",
            ownerId: "ops",
            issues: [],
            updatedAt: "2026-01-01T00:00:00.000Z",
          },
        ],
        uploadedAssets: [
          {
            id: "asset-missing-task",
            ownerId: "designer",
            name: "missing-task.png",
            type: "image/png",
            size: 1,
            taskId: "missing-task",
            productId: "p1",
            purpose: "input",
            createdAt: "2026-01-01T00:00:00.000Z",
          },
          {
            id: "asset-missing-product",
            ownerId: "designer",
            name: "missing-product.png",
            type: "image/png",
            size: 1,
            taskId: "task-missing-product",
            productId: "missing-product",
            purpose: "output",
            createdAt: "2026-01-01T00:00:00.000Z",
          },
          {
            id: "asset-wrong-product",
            ownerId: "designer",
            name: "wrong-product.png",
            type: "image/png",
            size: 1,
            taskId: "task-ok",
            productId: "p2",
            purpose: "output",
            createdAt: "2026-01-01T00:00:00.000Z",
          },
        ],
      },
      databaseFileReady: true,
      uploadDirectoryReady: true,
      backupDirectoryReady: true,
      backupCount: 1,
      backupRetention: 14,
      openAiConfigured: true,
      openAiLastFailure: null,
      amazonConfigured: true,
      amazonConnectorReady: true,
      amazonMode: "sandbox",
      initialAdminPasswordConfigured: true,
      initialAdminPasswordUsesDefault: false,
      initialEmployeePasswordUsesDefault: false,
      apiPort: 8787,
      nodeVersion: "v22.0.0",
    });

    const relations = report.items.find((item) => item.key === "data-relations");
    expect(relations?.status).toBe("warning");
    expect(relations?.detail).toContain("7 个关联异常");
    expect(relations?.detail).toContain("1 个任务缺少 SKU 商品");
    expect(relations?.detail).toContain("1 个任务 SKU 与商品库不一致");
    expect(relations?.detail).toContain("1 条 Listing 未匹配商品库");
    expect(relations?.detail).toContain("1 个素材缺少任务");
    expect(relations?.detail).toContain("1 个素材缺少 SKU 商品");
    expect(relations?.detail).toContain("1 个素材 SKU 与任务不一致");
    expect(relations?.detail).toContain("1 个任务引用了不存在的素材");
    expect(relations?.action).toContain("修复或清理缺失关联");
  });

  it("warns when backups and external integrations are not ready", () => {
    const report = buildSystemHealthReport({
      data: {
        ...baseData,
        products: [{ id: "p1", sku: "SKU-1", name: "产品", brand: "花彩", category: "家居", marketplace: "美国站", status: "Active", imageCount: 0, updatedAt: "2026-01-01T00:00:00.000Z" }],
      },
      generatedAt: "2026-01-01T00:00:00.000Z",
      databaseFileReady: true,
      uploadDirectoryReady: true,
      backupDirectoryReady: true,
      backupCount: 0,
      backupRetention: 14,
      openAiConfigured: false,
      openAiLastFailure: null,
      amazonConfigured: false,
      amazonConnectorReady: false,
      amazonMode: "sandbox",
      apiPort: 8787,
      nodeVersion: "v22.0.0",
    });

    expect(report.status).toBe("warning");
    expect(report.summary.products).toBe(1);
    expect(report.items.find((item) => item.key === "backups")?.status).toBe("warning");
    expect(report.items.find((item) => item.key === "ai")?.action).toContain("OPENAI_API_KEY");
  });

  it("reports errors for missing core persistence paths", () => {
    const report = buildSystemHealthReport({
      data: baseData,
      databaseFileReady: false,
      uploadDirectoryReady: false,
      backupDirectoryReady: false,
      backupCount: 0,
      backupRetention: 14,
      openAiConfigured: true,
      openAiLastFailure: null,
      amazonConfigured: true,
      amazonConnectorReady: true,
      amazonMode: "production",
      apiPort: 8787,
      nodeVersion: "v22.0.0",
    });

    expect(report.status).toBe("error");
    expect(report.items.filter((item) => item.status === "error").map((item) => item.key)).toEqual([
      "database",
      "uploads",
      "backups",
    ]);
  });
});
