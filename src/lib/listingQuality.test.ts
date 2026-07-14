import { describe, expect, it } from "vitest";
import type { AmazonListing, GenerationTask } from "../types/domain";
import type { AmazonCategoryTemplate } from "./amazonTemplate";
import {
  amazonTemplateCompatibilityWarnings,
  buildListingQualityReport,
} from "./listingQuality";

const listing = (overrides: Partial<AmazonListing> = {}): AmazonListing => ({
  id: "listing-1",
  sku: "HC-HDP-001",
  marketplaceId: "ATVPDKIKX0DER",
  marketplaceName: "美国站",
  productType: "HEADPHONES",
  title: "FLORA Wireless Noise Cancelling Headphones for Travel Work and Everyday Listening",
  brand: "FLORA",
  description: "Comfortable wireless over-ear headphones designed for focused work, commuting, travel and everyday entertainment.",
  bulletPoints: [
    "Active noise cancellation helps reduce ambient noise for focused listening",
    "Soft over-ear cushions support comfortable long-time wear at home or office",
    "Wireless Bluetooth connection works with phones, tablets and computers",
    "Foldable structure makes the headphones easier to store and carry while traveling",
    "Long battery life supports work, calls, entertainment and daily commuting",
  ],
  searchTerms: "wireless headphones noise cancelling bluetooth over ear travel work",
  price: 59.99,
  currency: "USD",
  quantity: 100,
  status: "草稿",
  ownerId: "emp-zhang",
  issues: [],
  updatedAt: "2026-07-06T00:00:00.000Z",
  ...overrides,
});

const template = (overrides: Partial<AmazonCategoryTemplate> = {}): AmazonCategoryTemplate => ({
  fileName: "HEADPHONES.xlsx",
  productTypes: ["HEADPHONES"],
  marketplaceIds: ["ATVPDKIKX0DER"],
  locales: ["en_US"],
  columnCount: 3,
  columnAttributes: [
    "contribution_sku#1.value",
    "product_type#1.value",
    "item_name[marketplace_id=ATVPDKIKX0DER][language_tag=en_US]#1.value",
  ],
  attributeRowNumber: 3,
  fields: [
    {
      group: "Offer",
      attribute: "contribution_sku#1.value",
      label: "SKU",
      description: "",
      example: "",
      requirement: "required",
    },
    {
      group: "Offer",
      attribute: "product_type#1.value",
      label: "Product Type",
      description: "",
      example: "",
      requirement: "required",
    },
    {
      group: "Product",
      attribute: "item_name[marketplace_id=ATVPDKIKX0DER][language_tag=en_US]#1.value",
      label: "Item Name",
      description: "",
      example: "",
      requirement: "required",
    },
  ],
  requiredCount: 3,
  conditionalCount: 0,
  optionalCount: 0,
  ...overrides,
});

const visualTask = (overrides: Partial<GenerationTask> = {}): GenerationTask => ({
  id: "TSK-VISUAL-001",
  productId: "product-1",
  sku: "HC-HDP-001",
  productName: "Wireless Headphones",
  type: "Amazon 六图套图",
  status: "已通过",
  progress: 100,
  owner: "林晓",
  assignedToId: "designer-1",
  assignedToName: "林晓",
  outputAssetIds: ["a1", "a2", "a3", "a4", "a5", "a6"],
  outputCount: 6,
  version: 1,
  updatedAt: "2026-07-06T00:00:00.000Z",
  ...overrides,
});

describe("Listing quality helpers", () => {
  it("warns when a Seller Central template does not match the current product type", () => {
    expect(amazonTemplateCompatibilityWarnings(listing(), template({ productTypes: ["WALL_ART"] })))
      .toEqual(["当前 Product Type 是 HEADPHONES，但模板属于 WALL_ART，请确认是否上传了正确类目模板"]);
  });

  it("warns when marketplace does not match the template", () => {
    expect(amazonTemplateCompatibilityWarnings(listing(), template({ marketplaceIds: ["A1F83G8C2ARO7P"] })))
      .toContain("当前目标站点与模板站点不一致，请确认 Seller Central 模板来自同一个 Amazon 站点");
  });

  it("builds a high quality report for complete listing data", () => {
    const report = buildListingQualityReport(listing(), template());

    expect(report.score).toBe(100);
    expect(report.blockers).toEqual([]);
    expect(report.templateMissingCount).toBe(0);
  });

  it("surfaces practical blockers for incomplete listing data", () => {
    const report = buildListingQualityReport(listing({
      title: "",
      bulletPoints: ["short", "", "", "", ""],
      description: "",
      price: 0,
    }), template());

    expect(report.score).toBeLessThan(70);
    expect(report.blockers).toContain("英文标题不能为空");
    expect(report.blockers).toContain("售价必须大于 0");
    expect(report.blockers.some((issue) => issue.includes("五点卖点还不够完整"))).toBe(true);
  });

  it("builds an actionable checklist grouped by workflow owner", () => {
    const report = buildListingQualityReport(listing({
      title: "",
      brand: "",
      price: 0,
      quantity: 0,
    }), null);

    const foundation = report.sections.find((section) => section.id === "foundation");
    const copy = report.sections.find((section) => section.id === "copy");
    const templateSection = report.sections.find((section) => section.id === "amazon-template");

    expect(foundation?.checks.find((item) => item.id === "brand")).toMatchObject({
      status: "blocked",
      owner: "运营",
    });
    expect(foundation?.checks.find((item) => item.id === "quantity")).toMatchObject({
      status: "warning",
      owner: "运营",
    });
    expect(copy?.checks.find((item) => item.id === "title")).toMatchObject({
      status: "blocked",
      action: "围绕核心关键词 + 材质/功能 + 尺寸/场景重写",
    });
    expect(templateSection?.checks.find((item) => item.id === "template-file")).toMatchObject({
      status: "warning",
      owner: "运营",
    });
    expect(report.nextActions[0].status).toBe("blocked");
  });

  it("shows visual readiness from approved same-SKU image tasks", () => {
    const report = buildListingQualityReport(listing(), template(), [visualTask()]);
    const visualSection = report.sections.find((section) => section.id === "visuals");

    expect(visualSection?.checks.find((item) => item.id === "visual-main-image")).toMatchObject({
      status: "done",
      owner: "运营",
    });
    expect(visualSection?.checks.find((item) => item.id === "visual-six-pack")).toMatchObject({
      status: "done",
      detail: "已通过 6 张六图套图，可进入完整 Listing 交付",
    });
    expect(report.nextActions.some((item) => item.id === "visual-six-pack")).toBe(false);
  });

  it("reminds operators when a listing has no approved visual handoff yet", () => {
    const report = buildListingQualityReport(listing(), template(), [
      visualTask({
        id: "other-sku-task",
        sku: "OTHER-SKU",
      }),
    ]);
    const visualSection = report.sections.find((section) => section.id === "visuals");

    expect(visualSection?.checks.find((item) => item.id === "visual-main-image")).toMatchObject({
      status: "warning",
      owner: "运营",
      action: "从新建生成任务创建白底主图或六图任务",
    });
    expect(report.nextActions.some((item) => item.id === "visual-main-image")).toBe(true);
  });

  it("blocks generated draft placeholders until operators replace them", () => {
    const report = buildListingQualityReport(listing({
      description: "待补充：基于真实规格整理成适合美国站的 Amazon 商品描述。",
      bulletPoints: [
        "待补充：说明核心卖点、目标买家和主要使用场景。",
        "待补充：确认材质、尺寸、颜色、包装数量等真实规格。",
        "待补充：补充安装、清洁、收纳、维护或使用注意事项。",
        "待补充：写清适用于目标买家的差异化优势。",
        "待补充：检查所有承诺都有商品资料或图片支持。",
      ],
    }));

    expect(report.blockers).toContain("五点卖点仍包含待补充或占位内容，请改成真实商品卖点");
    expect(report.blockers).toContain("商品描述仍包含待补充或占位内容，请改成真实商品描述");
  });
});
