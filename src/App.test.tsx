import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import {
  createListing,
  getCurrentUser,
  getListings,
  getNotifications,
  getWorkspace,
  logout,
  markNotificationRead,
  updateWorkspaceProduct,
} from "./lib/api";

vi.mock("./lib/api", () => ({
  createWorkspaceProduct: vi.fn(),
  createWorkspaceTask: vi.fn(),
  createListing: vi.fn(),
  deleteAssets: vi.fn(),
  deleteListing: vi.fn(),
  deleteWorkspaceProduct: vi.fn(),
  getAssetObjectUrl: vi.fn(),
  getAmazonProductTypeDefinition: vi.fn(),
  getAmazonStatus: vi.fn().mockResolvedValue({ configured: false, connectorReady: false, mode: "sandbox" }),
  getCurrentUser: vi.fn(),
  getDemoDataStatus: vi.fn().mockResolvedValue({ detected: false, productCount: 0, taskCount: 0, listingCount: 0, activityCount: 0 }),
  getListings: vi.fn().mockResolvedValue([]),
  getNotifications: vi.fn().mockResolvedValue([]),
  getTeamDirectory: vi.fn().mockResolvedValue([]),
  getWorkspace: vi.fn().mockResolvedValue({
    products: [{
      id: "product-1",
      sku: "HC-001",
      name: "测试商品",
      brand: "花彩",
      category: "家居",
      marketplace: "美国站",
      status: "可生成",
      imageCount: 1,
      updatedAt: "2026-07-02",
    }],
    tasks: [],
  }),
  getWorkspaceSummary: vi.fn().mockResolvedValue({
    generatedThisMonth: 12,
    monthlyQuota: 500,
    activeImageJobs: 1,
  }),
  hasAuthToken: vi.fn().mockReturnValue(true),
  importWorkspaceProducts: vi.fn(),
  logout: vi.fn().mockResolvedValue(undefined),
  markAllNotificationsRead: vi.fn(),
  markNotificationRead: vi.fn(),
  recordActivity: vi.fn(),
  removeDemoData: vi.fn(),
  refreshListingStatus: vi.fn(),
  reviewWorkspaceTask: vi.fn(),
  searchAmazonProductTypes: vi.fn(),
  submitListing: vi.fn(),
  submitWorkspaceTaskOutputs: vi.fn(),
  updateListing: vi.fn(),
  updateWorkspaceTaskAssignment: vi.fn(),
  updateWorkspaceProduct: vi.fn(),
  uploadTaskImages: vi.fn(),
  validateListing: vi.fn(),
}));

describe("App 退出登录入口", () => {
  beforeEach(() => {
    vi.mocked(getCurrentUser).mockResolvedValue({
      id: "employee-1",
      username: "admin",
      name: "张宁",
      department: "Amazon 运营",
      role: "管理员",
      active: true,
      mustChangePassword: false,
    });
    vi.mocked(getWorkspace).mockResolvedValue({
      products: [{
        id: "product-1",
        sku: "HC-001",
        name: "测试商品",
        brand: "花彩",
        category: "家居",
        marketplace: "美国站",
        status: "可生成",
        imageCount: 1,
        updatedAt: "2026-07-02",
      }],
      tasks: [],
    });
    vi.mocked(updateWorkspaceProduct).mockImplementation(async (product) => product);
    vi.mocked(createListing).mockImplementation(async (input) => ({
      id: "listing-created",
      sku: input.sku ?? "",
      asin: input.asin,
      marketplaceId: input.marketplaceId ?? "ATVPDKIKX0DER",
      marketplaceName: input.marketplaceName ?? "美国站",
      productType: input.productType ?? "",
      title: input.title ?? "",
      brand: input.brand ?? "",
      description: input.description ?? "",
      bulletPoints: input.bulletPoints ?? ["", "", "", "", ""],
      searchTerms: input.searchTerms ?? "",
      price: input.price ?? 0,
      currency: input.currency ?? "USD",
      quantity: input.quantity ?? 0,
      status: "待完善",
      ownerId: "employee-1",
      issues: [],
      updatedAt: "2026-07-02T00:00:00.000Z",
    }));
    vi.mocked(getListings).mockResolvedValue([]);
    vi.mocked(getNotifications).mockResolvedValue([]);
  });

  it("从账号菜单二次确认后才退出", async () => {
    const user = userEvent.setup();
    render(<App />);

    const accountButton = await screen.findByRole("button", { name: /张宁/ });
    await user.click(accountButton);
    await user.click(screen.getByRole("button", { name: /退出登录/ }));

    expect(screen.getByRole("dialog", { name: "确认退出花彩工作台？" })).toBeInTheDocument();
    expect(logout).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "留在工作台" }));
    expect(screen.queryByRole("dialog", { name: "确认退出花彩工作台？" })).not.toBeInTheDocument();
    expect(logout).not.toHaveBeenCalled();

    await user.click(accountButton);
    await user.click(screen.getByRole("button", { name: /退出登录/ }));
    await user.click(screen.getByRole("button", { name: "确认退出" }));

    await waitFor(() => expect(logout).toHaveBeenCalledTimes(1));
    expect(await screen.findByRole("heading", { name: "登录花彩工作台" })).toBeInTheDocument();
  });

  it("可在新建任务页直接修改当前公司 SKU", async () => {
    const user = userEvent.setup();
    render(<App />);

    await screen.findByRole("button", { name: /张宁/ });
    await user.click(screen.getByRole("button", { name: /新建生成任务/ }));
    await user.click(screen.getByRole("button", { name: "编辑当前商品" }));

    const skuInput = screen.getByRole("textbox", { name: "SKU" });
    await user.clear(skuInput);
    await user.type(skuInput, "COMPANY-001");
    await user.type(screen.getByRole("textbox", { name: /ASIN/ }), "b0abc12345");
    await user.click(screen.getByRole("button", { name: "保存修改" }));

    await waitFor(() => expect(updateWorkspaceProduct).toHaveBeenCalledWith(expect.objectContaining({
      id: "product-1",
      sku: "COMPANY-001",
      asin: "B0ABC12345",
    })));
    expect(screen.queryByRole("heading", { name: "编辑 SKU 商品" })).not.toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "SKU 商品" })).toHaveValue("product-1");
    expect(screen.getByRole("option", { name: "COMPANY-001 · 测试商品" })).toBeInTheDocument();
  });

  it("空工作区引导管理员先导入真实公司 SKU", async () => {
    const user = userEvent.setup();
    vi.mocked(getWorkspace).mockResolvedValue({ products: [], tasks: [] });
    render(<App />);

    expect(await screen.findByRole("heading", { name: "先把公司商品带进花彩。" })).toBeInTheDocument();
    expect(screen.getByText("0 / 3 已完成")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /导入 \/ 新建公司 SKU/ }));

    expect(screen.getByRole("heading", { name: "SKU 商品库" })).toBeInTheDocument();
    expect(screen.getByText("公司商品库还是空的")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Excel \/ CSV 导入/ })).toBeInTheDocument();
  });

  it("点击任务通知后直接打开对应任务详情", async () => {
    const user = userEvent.setup();
    const task = {
      id: "TSK-NOTIFY-001",
      productId: "product-1",
      sku: "HC-001",
      productName: "通知定位商品",
      type: "Amazon 六图套图" as const,
      status: "待生成" as const,
      progress: 0,
      owner: "林晓",
      assignedToId: "employee-1",
      assignedToName: "张宁",
      updatedAt: "刚刚",
    };
    const notification = {
      id: "notification-1",
      type: "TASK_ASSIGNED" as const,
      title: "你收到一个新任务",
      message: "HC-001 已分配给你",
      entityId: task.id,
      createdAt: "2026-07-02T00:00:00.000Z",
    };
    vi.mocked(getWorkspace).mockResolvedValue({
      products: [{
        id: "product-1", sku: "HC-001", name: "通知定位商品", brand: "花彩", category: "家居",
        marketplace: "美国站", status: "可生成", imageCount: 1, updatedAt: "刚刚",
      }],
      tasks: [task],
    });
    vi.mocked(getNotifications).mockResolvedValue([notification]);
    vi.mocked(markNotificationRead).mockResolvedValue({ ...notification, readAt: "2026-07-02T00:01:00.000Z" });
    render(<App />);

    await screen.findByRole("button", { name: /张宁/ });
    await user.click(screen.getByTitle("通知"));
    await user.click(screen.getByRole("button", { name: /你收到一个新任务/ }));

    expect(await screen.findByRole("dialog", { name: "通知定位商品" })).toBeInTheDocument();
    expect(screen.getByText("TSK-NOTIFY-001")).toBeInTheDocument();
    expect(markNotificationRead).toHaveBeenCalledWith("notification-1");
  });

  it("从已通过任务交接到 Listing 时自动创建对应 SKU 草稿", async () => {
    const user = userEvent.setup();
    const task = {
      id: "TSK-LISTING-001",
      productId: "product-1",
      sku: "HC-001",
      productName: "过审视觉商品",
      type: "Amazon 六图套图" as const,
      status: "已通过" as const,
      progress: 100,
      owner: "张宁",
      assignedToId: "designer-1",
      assignedToName: "林晓",
      outputCount: 6,
      outputAssetIds: ["asset-1", "asset-2"],
      version: 2,
      updatedAt: "刚刚",
    };
    vi.mocked(getWorkspace).mockResolvedValue({
      products: [{
        id: "product-1", sku: "HC-001", asin: "B0ABC12345", name: "过审视觉商品", brand: "花彩", category: "Wall Art",
        marketplace: "美国站", status: "可生成", imageCount: 1, updatedAt: "刚刚",
      }],
      tasks: [task],
    });
    vi.mocked(getListings).mockResolvedValue([]);
    render(<App />);

    await screen.findByRole("button", { name: /张宁/ });
    await user.click(screen.getByRole("button", { name: /任务中心/ }));
    await user.click(await screen.findByRole("button", { name: "查看任务 TSK-LISTING-001" }));
    await user.click(screen.getByRole("button", { name: /去 Listing 中心/ }));

    await waitFor(() => expect(createListing).toHaveBeenCalledWith(expect.objectContaining({
      sku: "HC-001",
      asin: "B0ABC12345",
      marketplaceId: "ATVPDKIKX0DER",
      title: expect.stringContaining("过审视觉商品"),
      bulletPoints: expect.arrayContaining([expect.stringContaining("待补充")]),
    })));
    expect(await screen.findByRole("heading", { name: "AI Listing 工作台" })).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "HC-001" })).toBeInTheDocument();
  });
});
