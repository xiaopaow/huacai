import { describe, expect, it } from "vitest";
import {
  amazonTemplateValuesToAttributes,
  buildListingsItemPayload,
  summarizeAmazonProductType,
  validateListing,
  type AmazonProductTypeDefinition,
  type AmazonProductTypeSchema,
} from "./amazon.js";
import type { AmazonListing } from "./types.js";

describe("Amazon Product Type Definitions", () => {
  it("summarizes required fields, groups and enumerated values", () => {
    const definition: AmazonProductTypeDefinition = {
      metaSchema: { link: { resource: "https://example.com/meta", verb: "GET" }, checksum: "meta" },
      schema: { link: { resource: "https://example.com/schema", verb: "GET" }, checksum: "schema-1" },
      requirements: "LISTING",
      requirementsEnforced: "ENFORCED",
      propertyGroups: {
        product_identity: {
          title: "Product Identity",
          propertyNames: ["item_name", "brand"],
        },
      },
      locale: "en_US",
      marketplaceIds: ["ATVPDKIKX0DER"],
      productType: "WALL_ART",
      displayName: "Wall Art",
      productTypeVersion: { version: "v1", latest: true, releaseCandidate: false },
    };
    const schema: AmazonProductTypeSchema = {
      required: ["item_name"],
      properties: {
        item_name: {
          title: "Item Name",
          description: "Customer-facing title",
          type: "array",
          minItems: 1,
          items: {
            type: "object",
            properties: {
              value: { type: "string" },
              language_tag: { type: "string", enum: ["en_US"] },
            },
          },
        },
        brand: { title: "Brand", type: "array" },
      },
    };

    const summary = summarizeAmazonProductType(definition, schema);

    expect(summary.productType).toBe("WALL_ART");
    expect(summary.requiredCount).toBe(1);
    expect(summary.fields[0]).toMatchObject({
      name: "item_name",
      title: "Item Name",
      group: "product_identity",
      groupTitle: "Product Identity",
      required: true,
      enumValues: ["en_US"],
      minItems: 1,
    });
    expect(summary.fields[1].required).toBe(false);
  });
});

describe("Amazon template values to Listings Items payload", () => {
  it("converts selectors, repeated fields, nested offers and external product ids", () => {
    const attributes = amazonTemplateValuesToAttributes({
      "country_of_origin[marketplace_id=ATVPDKIKX0DER]#1.value": "China",
      "bullet_point[marketplace_id=ATVPDKIKX0DER][language_tag=en_US]#1.value": "First point",
      "bullet_point[marketplace_id=ATVPDKIKX0DER][language_tag=en_US]#2.value": "Second point",
      "fulfillment_availability#1.quantity": "25",
      "purchasable_offer[marketplace_id=ATVPDKIKX0DER][audience=ALL]#1.our_price#1.schedule#1.value_with_tax": "29.99",
      "amzn1.volt.ca.product_id_type": "UPC",
      "amzn1.volt.ca.product_id_value": "123456789012",
      "::record_action": "Create or Replace (Full Update)",
    }, "ATVPDKIKX0DER");

    expect(attributes.country_of_origin).toEqual([
      { marketplace_id: "ATVPDKIKX0DER", value: "China" },
    ]);
    expect(attributes.bullet_point).toEqual([
      { marketplace_id: "ATVPDKIKX0DER", language_tag: "en_US", value: "First point" },
      { marketplace_id: "ATVPDKIKX0DER", language_tag: "en_US", value: "Second point" },
    ]);
    expect(attributes.fulfillment_availability).toEqual([{ quantity: 25 }]);
    expect(attributes.purchasable_offer).toEqual([{
      marketplace_id: "ATVPDKIKX0DER",
      audience: "ALL",
      our_price: [{ schedule: [{ value_with_tax: 29.99 }] }],
    }]);
    expect(attributes.externally_assigned_product_identifier).toEqual([{
      type: "upc",
      value: "123456789012",
      marketplace_id: "ATVPDKIKX0DER",
    }]);
    expect(attributes).not.toHaveProperty("record_action");
  });

  it("merges category values into the final payload and uses purchasable_offer for price", () => {
    const listing: AmazonListing = {
      id: "listing-1",
      sku: "HC-WA-001",
      marketplaceId: "ATVPDKIKX0DER",
      marketplaceName: "美国站",
      productType: "WALL_ART",
      title: "Mountain Wall Art",
      brand: "Huacai",
      description: "Canvas wall art.",
      bulletPoints: ["Ready to hang", "Fade resistant", "Framed", "Lightweight", "Gift ready"],
      searchTerms: "wall art",
      price: 29.99,
      currency: "USD",
      quantity: 10,
      status: "可提交",
      ownerId: "employee-1",
      templateValues: {
        "country_of_origin[marketplace_id=ATVPDKIKX0DER]#1.value": "China",
        "item_name[marketplace_id=ATVPDKIKX0DER]#1.value": "Stale template title",
      },
      issues: [],
      updatedAt: "2026-07-02T00:00:00.000Z",
    };

    const payload = buildListingsItemPayload(listing);

    expect(payload.attributes).toHaveProperty("purchasable_offer");
    expect(payload.attributes).not.toHaveProperty("list_price");
    expect(payload.attributes.country_of_origin).toEqual([
      { marketplace_id: "ATVPDKIKX0DER", value: "China" },
    ]);
    expect(payload.attributes.item_name).toEqual([
      { marketplace_id: "ATVPDKIKX0DER", value: "Mountain Wall Art" },
    ]);
  });
});

describe("Amazon listing local validation", () => {
  it("enforces the upcoming Amazon title and bullet content limits", () => {
    const listing: AmazonListing = {
      id: "listing-short-bullets",
      sku: "HC-WA-001",
      marketplaceId: "ATVPDKIKX0DER",
      marketplaceName: "美国站",
      productType: "WALL_ART",
      title: "Huacai Framed Canvas Wall Art for Living Room Bedroom and Office Decor",
      brand: "Huacai",
      description: "Decorative framed canvas wall art designed for living rooms, bedrooms, offices and gifting scenes.",
      bulletPoints: ["Ready", "Gift", "Framed", "Light", "x".repeat(256)],
      searchTerms: "wall art framed canvas decor living room bedroom office",
      price: 29.99,
      currency: "USD",
      quantity: 10,
      status: "草稿",
      ownerId: "employee-1",
      issues: [],
      updatedAt: "2026-07-02T00:00:00.000Z",
    };

    const issues = validateListing(listing);
    expect(issues).toContain("第 5 条卖点超过 255 个字符");
  });

  it("blocks generated scaffold placeholders before Amazon submission", () => {
    const listing: AmazonListing = {
      id: "listing-placeholder",
      sku: "HC-WA-001",
      marketplaceId: "ATVPDKIKX0DER",
      marketplaceName: "美国站",
      productType: "WALL_ART",
      title: "Huacai Wall Art",
      brand: "Huacai",
      description: "待补充：基于真实规格整理成适合美国站的 Amazon 商品描述。",
      bulletPoints: [
        "待补充：说明核心卖点、目标买家和主要使用场景。",
        "待补充：确认材质、尺寸、颜色、包装数量等真实规格。",
        "待补充：补充安装、清洁、收纳、维护或使用注意事项。",
        "待补充：写清适用于目标买家的差异化优势。",
        "待补充：检查所有承诺都有商品资料或图片支持。",
      ],
      searchTerms: "wall art huacai",
      price: 29.99,
      currency: "USD",
      quantity: 10,
      status: "草稿",
      ownerId: "employee-1",
      issues: [],
      updatedAt: "2026-07-02T00:00:00.000Z",
    };

    const issues = validateListing(listing);

    expect(issues).toContain("五点卖点仍包含待补充或占位内容，请改成真实商品卖点");
    expect(issues).toContain("商品描述仍包含待补充或占位内容，请改成真实商品描述");
  });
});
