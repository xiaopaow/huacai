import { describe, expect, it } from "vitest";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import {
  analyzeAmazonTemplateSheets,
  amazonTemplateFieldSource,
  buildAmazonTemplateValues,
  createFilledAmazonTemplate,
  missingAmazonTemplateFields,
  summarizeAmazonTemplateCompletion,
} from "./amazonTemplate";
import type { AmazonListing } from "../types/domain";

describe("Amazon category template analyzer", () => {
  it("extracts product type, marketplace and requirement counts", () => {
    const result = analyzeAmazonTemplateSheets([
      {
        sheet: "数据定义",
        data: [
          ["组名称", "字段名称", "本地标签名称", "可接受值", "示例", "必填？"],
          ["商品信息标识", null, null, null, null, null],
          [null, "contribution_sku#1.value", "SKU", "库存单位", "ABC123", "必填"],
          [null, "item_name[marketplace_id=ATVPDKIKX0DER][language_tag=en_US]#1.value", "Item Name", "Title", "Desk Lamp", "在一定条件下必填"],
          [null, "::record_action", "操作", "Action", "Create", "可选"],
        ],
      },
      {
        sheet: "模板",
        data: [
          ["settings=primaryMarketplaceId=amzn1.mp.o.ATVPDKIKX0DER"],
          ["SKU", "Item Name", "操作"],
          ["contribution_sku#1.value", "item_name[marketplace_id=ATVPDKIKX0DER][language_tag=en_US]#1.value", "::record_action"],
        ],
      },
      { sheet: "AttributePTDMAP", data: [["378", "WALL_ART"]] },
    ], "WALL_ART.xlsm");

    expect(result.productTypes).toEqual(["WALL_ART"]);
    expect(result.marketplaceIds).toEqual(["ATVPDKIKX0DER"]);
    expect(result.locales).toEqual(["en_US"]);
    expect(result.columnCount).toBe(3);
    expect(result.requiredCount).toBe(1);
    expect(result.conditionalCount).toBe(1);
    expect(result.optionalCount).toBe(1);
  });

  it("rejects a regular workbook", () => {
    expect(() => analyzeAmazonTemplateSheets([{ sheet: "Sheet1", data: [["SKU"]] }]))
      .toThrow("未识别到 Amazon");
  });

  it("maps listing values and preserves the workbook package while appending a data row", async () => {
    const template = analyzeAmazonTemplateSheets([
      {
        sheet: "数据定义",
        data: [
          ["组名称", "字段名称", "本地标签名称", "可接受值", "示例", "必填？"],
          ["商品信息标识", null, null, null, null, null],
          [null, "contribution_sku#1.value", "SKU", "", "ABC123", "必填"],
          [null, "product_type#1.value", "产品类型", "", "WALL_ART", "必填"],
          [null, "item_name[marketplace_id=ATVPDKIKX0DER][language_tag=en_US]#1.value", "Item Name", "", "Wall Art", "必填"],
        ],
      },
      {
        sheet: "模板",
        data: [
          ["settings=primaryMarketplaceId=amzn1.mp.o.ATVPDKIKX0DER"],
          ["SKU", "产品类型", "Item Name"],
          ["contribution_sku#1.value", "product_type#1.value", "item_name[marketplace_id=ATVPDKIKX0DER][language_tag=en_US]#1.value"],
        ],
      },
      { sheet: "AttributePTDMAP", data: [["378", "WALL_ART"]] },
    ], "WALL_ART.xlsm");
    const listing: AmazonListing = {
      id: "listing-1",
      sku: "HC-WA-001",
      marketplaceId: "ATVPDKIKX0DER",
      marketplaceName: "美国站",
      productType: "WALL_ART",
      title: "Mountain Canvas Wall Art",
      brand: "Huacai",
      description: "",
      bulletPoints: [],
      searchTerms: "",
      price: 29.99,
      currency: "USD",
      quantity: 10,
      status: "草稿",
      ownerId: "employee-1",
      issues: [],
      updatedAt: "2026-07-02T00:00:00.000Z",
    };
    const values = buildAmazonTemplateValues(listing, template);
    expect(values["contribution_sku#1.value"]).toBe("HC-WA-001");
    expect(missingAmazonTemplateFields(template, values)).toEqual([]);

    const source = zipSync({
      "[Content_Types].xml": strToU8("<Types/>"),
      "xl/workbook.xml": strToU8('<workbook><sheets><sheet name="模板" sheetId="1" r:id="rId1"/></sheets></workbook>'),
      "xl/_rels/workbook.xml.rels": strToU8('<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>'),
      "xl/worksheets/sheet1.xml": strToU8('<worksheet><dimension ref="A1:C3"/><sheetData><row r="3"><c r="A3"/></row></sheetData></worksheet>'),
      "xl/keep.bin": new Uint8Array([1, 2, 3]),
    });
    const output = await createFilledAmazonTemplate(source.buffer as ArrayBuffer, template, values);
    const files = unzipSync(output);
    const sheet = strFromU8(files["xl/worksheets/sheet1.xml"]);
    expect(sheet).toContain('<row r="4">');
    expect(sheet).toContain("HC-WA-001");
    expect(sheet).toContain("Mountain Canvas Wall Art");
    expect(files["xl/keep.bin"]).toEqual(new Uint8Array([1, 2, 3]));
  });

  it("summarizes required and conditional template completion", () => {
    const template = analyzeAmazonTemplateSheets([
      {
        sheet: "数据定义",
        data: [
          ["组名称", "字段名称", "本地标签名称", "可接受值", "示例", "必填？"],
          ["商品信息标识", null, null, null, null, null],
          [null, "contribution_sku#1.value", "SKU", "", "ABC123", "必填"],
          [null, "item_name#1.value", "Item Name", "", "Wall Art", "必填"],
          ["安全合规", null, null, null, null, null],
          [null, "supplier_declared_dg_hz_regulation#1.value", "Dangerous Goods", "", "Not Applicable", "在一定条件下必填"],
          [null, "battery#1.cell_composition#1.value", "Battery Composition", "", "Lithium Ion", "在一定条件下必填"],
        ],
      },
      {
        sheet: "模板",
        data: [
          ["settings=primaryMarketplaceId=amzn1.mp.o.ATVPDKIKX0DER"],
          ["SKU", "Item Name", "DG", "Battery"],
          ["contribution_sku#1.value", "item_name#1.value", "supplier_declared_dg_hz_regulation#1.value", "battery#1.cell_composition#1.value"],
        ],
      },
      { sheet: "AttributePTDMAP", data: [["378", "WALL_ART"]] },
    ], "WALL_ART.xlsm");

    const summary = summarizeAmazonTemplateCompletion(template, {
      "contribution_sku#1.value": "HC-001",
      "supplier_declared_dg_hz_regulation#1.value": "Not Applicable",
    });

    expect(summary.requiredFilled).toBe(1);
    expect(summary.missingRequired.map((item) => item.field.label)).toEqual(["Item Name"]);
    expect(summary.conditionalFilled).toBe(1);
    expect(summary.conditionalGroups).toEqual([{ group: "安全合规", total: 2, filled: 1 }]);
    expect(summary.required[0].source).toMatchObject({ kind: "listing", label: "SKU" });
    expect(summary.conditional[0].source).toMatchObject({ kind: "template", label: "类目字段" });
  });

  it("fills safe marketplace defaults and preserves operator overrides", () => {
    const template = analyzeAmazonTemplateSheets([
      {
        sheet: "数据定义",
        data: [
          ["组名称", "字段名称", "本地标签名称", "可接受值", "示例", "必填？"],
          ["商品信息", null, null, null, null, null],
          [null, "contribution_sku#1.value", "SKU", "", "HC-001", "必填"],
          [null, "brand[marketplace_id=ATVPDKIKX0DER][language_tag=en_US]#1.value", "品牌", "", "Huacai", "必填"],
          [null, "manufacturer[marketplace_id=ATVPDKIKX0DER][language_tag=en_US]#1.value", "制造商", "", "Huacai", "可选"],
          [null, "part_number[marketplace_id=ATVPDKIKX0DER]#1.value", "Part Number", "", "HC-001", "可选"],
          [null, "condition_type[marketplace_id=ATVPDKIKX0DER]#1.value", "商品状况", "", "New", "在一定条件下必填"],
          [null, "package_level[marketplace_id=ATVPDKIKX0DER]#1.value", "包装级别", "", "Unit", "可选"],
          [null, "country_of_origin[marketplace_id=ATVPDKIKX0DER]#1.value", "原产国", "", "China", "必填"],
          [null, "batteries_required[marketplace_id=ATVPDKIKX0DER]#1.value", "需要电池吗", "", "No", "在一定条件下必填"],
          [null, "has_multiple_battery_powered_components[marketplace_id=ATVPDKIKX0DER]#1.value", "多个电池组件", "", "No", "在一定条件下必填"],
          [null, "merchant_shipping_group[marketplace_id=ATVPDKIKX0DER]#1.value", "配送模板", "", "Default", "在一定条件下必填"],
          [null, "main_product_image_locator[marketplace_id=ATVPDKIKX0DER]#1.media_location", "主图 URL", "", "https://example.com/main.jpg", "可选"],
        ],
      },
      {
        sheet: "模板",
        data: [
          ["settings=primaryMarketplaceId=amzn1.mp.o.ATVPDKIKX0DER"],
          ["SKU"],
          [
            "contribution_sku#1.value",
            "brand[marketplace_id=ATVPDKIKX0DER][language_tag=en_US]#1.value",
            "manufacturer[marketplace_id=ATVPDKIKX0DER][language_tag=en_US]#1.value",
            "part_number[marketplace_id=ATVPDKIKX0DER]#1.value",
            "condition_type[marketplace_id=ATVPDKIKX0DER]#1.value",
            "package_level[marketplace_id=ATVPDKIKX0DER]#1.value",
            "country_of_origin[marketplace_id=ATVPDKIKX0DER]#1.value",
            "batteries_required[marketplace_id=ATVPDKIKX0DER]#1.value",
            "has_multiple_battery_powered_components[marketplace_id=ATVPDKIKX0DER]#1.value",
            "merchant_shipping_group[marketplace_id=ATVPDKIKX0DER]#1.value",
            "main_product_image_locator[marketplace_id=ATVPDKIKX0DER]#1.media_location",
          ],
        ],
      },
      { sheet: "AttributePTDMAP", data: [["378", "WALL_ART"]] },
    ], "WALL_ART.xlsm");
    const listing: AmazonListing = {
      id: "listing-defaults",
      sku: "HC-WA-888",
      marketplaceId: "ATVPDKIKX0DER",
      marketplaceName: "US",
      productType: "WALL_ART",
      title: "Canvas Wall Art",
      brand: "Huacai",
      description: "",
      bulletPoints: [],
      searchTerms: "",
      price: 18,
      currency: "USD",
      quantity: 5,
      status: "draft" as AmazonListing["status"],
      /*
      status: "鑽夌",
      */
      ownerId: "employee-1",
      templateValues: {
        "country_of_origin[marketplace_id=ATVPDKIKX0DER]#1.value": "United States",
        "condition_type[marketplace_id=ATVPDKIKX0DER]#1.value": "CollectibleLikeNew",
      },
      issues: [],
      updatedAt: "2026-07-02T00:00:00.000Z",
    };

    const values = buildAmazonTemplateValues(listing, template);

    expect(values["manufacturer[marketplace_id=ATVPDKIKX0DER][language_tag=en_US]#1.value"]).toBe("Huacai");
    expect(values["part_number[marketplace_id=ATVPDKIKX0DER]#1.value"]).toBe("HC-WA-888");
    expect(values["package_level[marketplace_id=ATVPDKIKX0DER]#1.value"]).toBe("Unit");
    expect(values["batteries_required[marketplace_id=ATVPDKIKX0DER]#1.value"]).toBe("No");
    expect(values["has_multiple_battery_powered_components[marketplace_id=ATVPDKIKX0DER]#1.value"]).toBe("No");
    expect(values["country_of_origin[marketplace_id=ATVPDKIKX0DER]#1.value"]).toBe("United States");
    expect(values["condition_type[marketplace_id=ATVPDKIKX0DER]#1.value"]).toBe("CollectibleLikeNew");
    expect(values["merchant_shipping_group[marketplace_id=ATVPDKIKX0DER]#1.value"]).toBeUndefined();
    expect(values["main_product_image_locator[marketplace_id=ATVPDKIKX0DER]#1.media_location"]).toBeUndefined();
    expect(amazonTemplateFieldSource("condition_type[marketplace_id=ATVPDKIKX0DER]#1.value"))
      .toMatchObject({ kind: "preset", label: "默认 New" });
    expect(amazonTemplateFieldSource("merchant_shipping_group[marketplace_id=ATVPDKIKX0DER]#1.value"))
      .toMatchObject({ kind: "template", label: "配送模板" });
    expect(missingAmazonTemplateFields(template, values).map((field) => field.attribute)).toEqual([]);
  });

  it("maps ASIN to newer external product identifier template fields", () => {
    const template = analyzeAmazonTemplateSheets([
      {
        sheet: "数据定义",
        data: [
          ["组名称", "字段名称", "本地标签名称", "可接受值", "示例", "必填？"],
          ["商品身份信息", null, null, null, null, null],
          [null, "contribution_sku#1.value", "SKU", "", "HC-001", "必填"],
          [null, "externally_assigned_product_identifier#1.type", "商品编码类型", "", "ASIN", "必填"],
          [null, "externally_assigned_product_identifier#1.value", "商品编码", "", "B0ABC12345", "必填"],
        ],
      },
      {
        sheet: "模板",
        data: [
          ["settings=primaryMarketplaceId=amzn1.mp.o.ATVPDKIKX0DER"],
          ["SKU", "商品编码类型", "商品编码"],
          ["contribution_sku#1.value", "externally_assigned_product_identifier#1.type", "externally_assigned_product_identifier#1.value"],
        ],
      },
      { sheet: "AttributePTDMAP", data: [["378", "WALL_ART"]] },
    ], "WALL_ART.xlsm");
    const values = buildAmazonTemplateValues({
      id: "listing-asin",
      sku: "HC-001",
      asin: "B0ABC12345",
      marketplaceId: "ATVPDKIKX0DER",
      marketplaceName: "美国站",
      productType: "WALL_ART",
      title: "Wall Art",
      brand: "Huacai",
      description: "",
      bulletPoints: [],
      searchTerms: "",
      price: 20,
      currency: "USD",
      quantity: 10,
      status: "草稿",
      ownerId: "employee-1",
      issues: [],
      updatedAt: "2026-07-02T00:00:00.000Z",
    }, template);

    expect(values["externally_assigned_product_identifier#1.type"]).toBe("ASIN");
    expect(values["externally_assigned_product_identifier#1.value"]).toBe("B0ABC12345");
    expect(missingAmazonTemplateFields(template, values)).toEqual([]);
    expect(amazonTemplateFieldSource("externally_assigned_product_identifier#1.value"))
      .toMatchObject({ kind: "listing", label: "ASIN/商品编码" });
  });
});
