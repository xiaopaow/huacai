import type { AmazonListing, GenerationTask } from "../types/domain";
import {
  buildAmazonTemplateValues,
  missingAmazonTemplateFields,
  type AmazonCategoryTemplate,
} from "./amazonTemplate";

function normalize(value: string) {
  return value.trim().toUpperCase();
}

function filled(value: string) {
  return value.trim().length > 0;
}

function hasDraftPlaceholder(value: string) {
  return /待补充|请补充|TODO|REPLACE|占位|确认真实|未经确认/i.test(value);
}

export function amazonTemplateCompatibilityWarnings(
  listing: AmazonListing,
  template: AmazonCategoryTemplate | null,
) {
  if (!template) return [];
  const warnings: string[] = [];
  const templateProductTypes = template.productTypes.map(normalize).filter(Boolean);
  const currentProductType = normalize(listing.productType);
  if (
    currentProductType
    && templateProductTypes.length > 0
    && !templateProductTypes.includes(currentProductType)
  ) {
    warnings.push(`当前 Product Type 是 ${listing.productType}，但模板属于 ${template.productTypes.join("、")}，请确认是否上传了正确类目模板`);
  }

  if (
    listing.marketplaceId
    && template.marketplaceIds.length > 0
    && !template.marketplaceIds.includes(listing.marketplaceId)
  ) {
    warnings.push("当前目标站点与模板站点不一致，请确认 Seller Central 模板来自同一个 Amazon 站点");
  }

  return warnings;
}

export interface ListingQualityReport {
  score: number;
  blockers: string[];
  suggestions: string[];
  templateMissingCount: number;
  sections: ListingQualitySection[];
  nextActions: ListingQualityCheck[];
}

export type ListingQualityCheckStatus = "done" | "warning" | "blocked";
export type ListingQualityOwner = "运营" | "美工" | "审核" | "管理员";

export interface ListingQualityCheck {
  id: string;
  label: string;
  status: ListingQualityCheckStatus;
  detail: string;
  owner: ListingQualityOwner;
  action?: string;
}

export interface ListingQualitySection {
  id: string;
  title: string;
  checks: ListingQualityCheck[];
}

function check(
  id: string,
  label: string,
  status: ListingQualityCheckStatus,
  detail: string,
  owner: ListingQualityOwner,
  action?: string,
): ListingQualityCheck {
  return { id, label, status, detail, owner, action };
}

function nextActionPriority(item: ListingQualityCheck) {
  return item.status === "blocked" ? 0 : 1;
}

function collectNextActions(sections: ListingQualitySection[]) {
  return sections
    .flatMap((section) => section.checks)
    .filter((item) => item.status !== "done")
    .sort((a, b) => nextActionPriority(a) - nextActionPriority(b))
    .slice(0, 6);
}

function taskOutputCount(task: Pick<GenerationTask, "outputAssetIds" | "outputCount">) {
  return task.outputCount ?? task.outputAssetIds?.length ?? 0;
}

function newestTaskFirst(a: Pick<GenerationTask, "updatedAt">, b: Pick<GenerationTask, "updatedAt">) {
  return b.updatedAt.localeCompare(a.updatedAt);
}

function visualChecksForListing(
  listing: AmazonListing,
  tasks: GenerationTask[],
): ListingQualityCheck[] {
  const sku = normalize(listing.sku);
  const related = tasks
    .filter((task) => normalize(task.sku) === sku)
    .sort(newestTaskFirst);
  const sixPackTasks = related.filter((task) => task.type === "Amazon 六图套图");
  const mainImageTasks = related.filter((task) => task.type === "Amazon 白底主图");
  const approvedSixPack = sixPackTasks.find((task) => task.status === "已通过" && taskOutputCount(task) >= 6);
  const approvedAnyVisual = related.find((task) => task.status === "已通过" && taskOutputCount(task) > 0);
  const approvedMainImage = mainImageTasks.find((task) => task.status === "已通过" && taskOutputCount(task) >= 1)
    ?? approvedSixPack;
  const pendingReview = related.find((task) => task.status === "待审核");
  const inProgress = related.find((task) => task.status === "生成中" || task.status === "待生成" || task.status === "已驳回");
  const shortApprovedSixPack = sixPackTasks.find((task) => task.status === "已通过" && taskOutputCount(task) > 0);

  const mainImageStatus: ListingQualityCheckStatus = approvedMainImage
    ? "done"
    : pendingReview || inProgress || related.length
      ? "warning"
      : "warning";
  const sixPackStatus: ListingQualityCheckStatus = approvedSixPack ? "done" : "warning";
  const reviewStatus: ListingQualityCheckStatus = approvedAnyVisual ? "done" : "warning";

  return [
    check(
      "visual-main-image",
      "白底主图",
      mainImageStatus,
      approvedMainImage
        ? `${approvedMainImage.type} 已通过审核，可作为 Listing 主图来源`
        : pendingReview
          ? `${pendingReview.type} 已提交审核，等待确认`
          : inProgress
            ? `${inProgress.type} 正在处理，负责人：${inProgress.assignedToName || inProgress.owner || "待确认"}`
            : related.length
              ? "同 SKU 有视觉任务，但还没有可用的已通过主图"
              : "未找到同 SKU 的主图或六图任务",
      approvedMainImage ? "运营" : related.length ? "美工" : "运营",
      approvedMainImage ? undefined : related.length ? "跟进任务状态或审核结果" : "从新建生成任务创建白底主图或六图任务",
    ),
    check(
      "visual-six-pack",
      "六图套图",
      sixPackStatus,
      approvedSixPack
        ? `已通过 ${taskOutputCount(approvedSixPack)} 张六图套图，可进入完整 Listing 交付`
        : shortApprovedSixPack
          ? `已有 ${taskOutputCount(shortApprovedSixPack)} 张通过图，但还不足完整 6 张`
          : pendingReview
            ? `${pendingReview.type} 已提交审核，六图交付待确认`
            : inProgress
              ? `${inProgress.type} 正在处理，尚未形成完整交付`
              : "还没有已通过的 Amazon 六图套图",
      approvedSixPack ? "运营" : related.length ? "美工" : "运营",
      approvedSixPack ? undefined : "补齐并审核通过 6 张 Listing 图片",
    ),
    check(
      "visual-review-trace",
      "审核留痕",
      reviewStatus,
      approvedAnyVisual
        ? `${approvedAnyVisual.type} 已通过审核，系统已有交付记录`
        : pendingReview
          ? "视觉结果已进入审核中心，等待审核结论"
          : "正式交付前建议让图片经过审核中心，避免口头确认后不可追溯",
      approvedAnyVisual ? "运营" : pendingReview ? "审核" : "运营",
      approvedAnyVisual ? undefined : pendingReview ? "审核通过后再交付给运营" : "创建任务并通过审核中心留痕",
    ),
  ];
}

export function buildListingQualityReport(
  listing: AmazonListing,
  template: AmazonCategoryTemplate | null = null,
  tasks: GenerationTask[] = [],
): ListingQualityReport {
  const blockers: string[] = [];
  const suggestions: string[] = [];
  const sections: ListingQualitySection[] = [];
  let score = 0;
  const foundationChecks: ListingQualityCheck[] = [];

  if (filled(listing.sku)) {
    score += 8;
    foundationChecks.push(check("sku", "SKU", "done", `当前 SKU：${listing.sku.trim()}`, "运营"));
  } else {
    blockers.push("SKU 不能为空");
    foundationChecks.push(check("sku", "SKU", "blocked", "创建 Listing 前必须绑定公司真实 SKU", "运营", "先在 SKU 商品库补齐商品"));
  }

  if (filled(listing.productType)) {
    score += 10;
    foundationChecks.push(check("product-type", "Amazon Product Type", "done", `当前类目：${listing.productType.trim()}`, "运营"));
  } else {
    blockers.push("必须选择 Amazon Product Type");
    foundationChecks.push(check("product-type", "Amazon Product Type", "blocked", "没有类目就无法确认 Amazon 必填字段", "运营", "搜索官方类目或上传 Seller Central 模板"));
  }

  if (filled(listing.brand)) {
    score += 8;
    foundationChecks.push(check("brand", "品牌", "done", `当前品牌：${listing.brand.trim()}`, "运营"));
  } else {
    blockers.push("品牌不能为空");
    foundationChecks.push(check("brand", "品牌", "blocked", "品牌不能为空，后续上传模板也会用到", "运营", "补充品牌或确认是否使用 Generic"));
  }

  foundationChecks.push(check(
    "marketplace",
    "目标站点",
    filled(listing.marketplaceId) ? "done" : "blocked",
    filled(listing.marketplaceId)
      ? `当前站点：${listing.marketplaceName || listing.marketplaceId}`
      : "需要选择美国站、英国站等目标站点",
    "运营",
    filled(listing.marketplaceId) ? undefined : "选择对应 Amazon 站点",
  ));

  const titleLength = listing.title.trim().length;
  if (titleLength > 0 && titleLength <= 200) score += 14;
  if (!titleLength) blockers.push("英文标题不能为空");
  else if (hasDraftPlaceholder(listing.title)) blockers.push("标题仍包含待补充或占位内容，请替换为真实买家文案");
  else if (titleLength < 50) suggestions.push("标题偏短，建议补充核心关键词、材质/功能/尺寸等信息");
  else if (titleLength > 180) suggestions.push("标题接近 200 字符上限，提交前要再复核类目限制");

  const copyChecks: ListingQualityCheck[] = [
    check(
      "title",
      "英文标题",
      !titleLength || hasDraftPlaceholder(listing.title)
        ? "blocked"
        : titleLength < 50 || titleLength > 180
          ? "warning"
          : "done",
      !titleLength
        ? "标题不能为空"
        : hasDraftPlaceholder(listing.title)
          ? "标题仍像草稿，需要换成真实买家文案"
          : titleLength < 50
            ? `当前 ${titleLength}/200 字符，建议补充核心关键词、材质、尺寸或用途`
            : titleLength > 180
              ? `当前 ${titleLength}/200 字符，接近上限，提交前要复核类目限制`
              : `当前 ${titleLength}/200 字符，长度比较健康`,
      "运营",
      "围绕核心关键词 + 材质/功能 + 尺寸/场景重写",
    ),
  ];

  const strongBullets = listing.bulletPoints.filter((point) => point.trim().length >= 30).length;
  if (strongBullets >= 5) score += 18;
  else blockers.push(`五点卖点还不够完整，建议 5 条都写到 30 字符以上（当前 ${strongBullets}/5）`);
  if (listing.bulletPoints.some(hasDraftPlaceholder)) {
    blockers.push("五点卖点仍包含待补充或占位内容，请改成真实商品卖点");
  }
  copyChecks.push(check(
    "bullet-points",
    "五点卖点",
    strongBullets >= 5 && !listing.bulletPoints.some(hasDraftPlaceholder) ? "done" : "blocked",
    listing.bulletPoints.some(hasDraftPlaceholder)
      ? "卖点仍包含待补充/占位内容"
      : strongBullets >= 5
        ? "5 条卖点都已达到基础长度"
        : `当前 ${strongBullets}/5 条达到 30 字符以上`,
    "运营",
    "每条对应一个真实卖点：材质、尺寸、场景、包装、差异化",
  ));

  const descriptionLength = listing.description.trim().length;
  if (descriptionLength >= 80) score += 12;
  else if (descriptionLength > 0) suggestions.push("商品描述偏短，建议补充使用场景、包装内容、注意事项或售后信息");
  else blockers.push("商品描述不能为空");
  if (filled(listing.description) && hasDraftPlaceholder(listing.description)) {
    blockers.push("商品描述仍包含待补充或占位内容，请改成真实商品描述");
  }
  copyChecks.push(check(
    "description",
    "商品描述",
    !descriptionLength || hasDraftPlaceholder(listing.description)
      ? "blocked"
      : descriptionLength < 80
        ? "warning"
        : "done",
    !descriptionLength
      ? "描述不能为空"
      : hasDraftPlaceholder(listing.description)
        ? "描述仍包含草稿占位内容"
        : descriptionLength < 80
          ? `当前 ${descriptionLength} 字符，建议补充使用场景、包装和注意事项`
          : "描述已达到基础完整度",
    "运营",
    "补充真实规格、适用场景、包装内容和注意事项",
  ));

  if (listing.searchTerms.trim().length >= 20) score += 8;
  else suggestions.push("Search Terms 偏少，建议补充同义词、使用场景和长尾搜索词");
  if (filled(listing.searchTerms) && hasDraftPlaceholder(listing.searchTerms)) {
    blockers.push("Search Terms 仍包含待补充或占位内容");
  }
  copyChecks.push(check(
    "search-terms",
    "Search Terms",
    filled(listing.searchTerms) && hasDraftPlaceholder(listing.searchTerms)
      ? "blocked"
      : listing.searchTerms.trim().length >= 20
        ? "done"
        : "warning",
    filled(listing.searchTerms) && hasDraftPlaceholder(listing.searchTerms)
      ? "关键词里仍有待补充内容"
      : listing.searchTerms.trim().length >= 20
        ? "关键词已覆盖基础搜索入口"
        : "建议补充同义词、长尾词和使用场景词",
    "运营",
    "避免重复标题，补长尾词和买家搜索习惯",
  ));

  if (listing.price > 0) {
    score += 7;
    foundationChecks.push(check("price", "售价", "done", `${listing.currency || "USD"} ${listing.price}`, "运营"));
  } else {
    blockers.push("售价必须大于 0");
    foundationChecks.push(check("price", "售价", "blocked", "售价必须大于 0，才能进入提交流程", "运营", "补充真实售价"));
  }

  if (listing.quantity >= 0) {
    score += 5;
    foundationChecks.push(check("quantity", "库存", listing.quantity > 0 ? "done" : "warning", `当前库存：${listing.quantity}`, "运营", listing.quantity > 0 ? undefined : "确认是否要以 0 库存创建"));
  } else {
    blockers.push("库存不能小于 0");
    foundationChecks.push(check("quantity", "库存", "blocked", "库存不能小于 0", "运营", "修正库存数量"));
  }

  sections.push({ id: "foundation", title: "基础资料", checks: foundationChecks });
  sections.push({ id: "copy", title: "买家文案", checks: copyChecks });
  sections.push({ id: "visuals", title: "视觉素材", checks: visualChecksForListing(listing, tasks) });

  const templateWarnings = amazonTemplateCompatibilityWarnings(listing, template);
  if (templateWarnings.length) blockers.push(...templateWarnings);

  let templateMissingCount = 0;
  const templateChecks: ListingQualityCheck[] = [];
  if (template) {
    const values = buildAmazonTemplateValues(listing, template);
    const missing = missingAmazonTemplateFields(template, values);
    templateMissingCount = missing.length;
    templateChecks.push(check(
      "template-file",
      "类目模板",
      "done",
      `已识别 ${template.columnCount} 个上传字段`,
      "运营",
    ));
    templateChecks.push(check(
      "template-product-type",
      "模板类目匹配",
      templateWarnings.some((item) => item.includes("Product Type")) ? "blocked" : "done",
      templateWarnings.find((item) => item.includes("Product Type")) ?? "Product Type 与模板没有发现冲突",
      "运营",
      "如不匹配，请重新上传正确类目的模板",
    ));
    templateChecks.push(check(
      "template-marketplace",
      "模板站点匹配",
      templateWarnings.some((item) => item.includes("目标站点")) ? "blocked" : "done",
      templateWarnings.find((item) => item.includes("目标站点")) ?? "目标站点与模板没有发现冲突",
      "运营",
      "如不匹配，请从对应站点 Seller Central 下载模板",
    ));
    if (missing.length) {
      blockers.push(`Amazon 模板还有 ${missing.length} 个直接必填字段未完成`);
      templateChecks.push(check(
        "template-required",
        "直接必填字段",
        "blocked",
        `还有 ${missing.length} 个直接必填字段未完成`,
        "运营",
        `优先补齐：${missing.slice(0, 3).map((field) => field.label).join("、")}`,
      ));
    } else {
      score += 10;
      templateChecks.push(check("template-required", "直接必填字段", "done", "直接必填字段已补齐", "运营"));
    }
    templateChecks.push(check(
      "template-conditional",
      "条件字段",
      template.conditionalCount > 0 ? "warning" : "done",
      template.conditionalCount > 0
        ? `模板包含 ${template.conditionalCount} 个条件字段，导出前建议按商品实际情况复核`
        : "模板没有识别到条件必填字段",
      "运营",
      template.conditionalCount > 0 ? "展开条件字段，补电池、合规、包装等类目要求" : undefined,
    ));
  } else {
    templateChecks.push(check(
      "template-file",
      "类目模板",
      "warning",
      "如果走表格上传，建议先上传 Seller Central 下载的类目模板",
      "运营",
      "上传 .xlsx/.xlsm 模板后系统会识别必填字段",
    ));
  }
  sections.push({ id: "amazon-template", title: "Amazon 模板", checks: templateChecks });

  const publishChecks: ListingQualityCheck[] = [];
  publishChecks.push(check(
    "local-validation",
    "本地可提交性",
    blockers.length ? "blocked" : "done",
    blockers.length ? `还有 ${blockers.length} 个阻断项` : "基础资料和模板检查未发现阻断项",
    "运营",
    blockers.length ? "按上方阻断项逐项补齐后再执行本地检查" : "保存草稿并执行本地检查",
  ));
  publishChecks.push(check(
    "amazon-submit",
    "Amazon 发布状态",
    listing.status === "可提交" || listing.status === "提交中" || listing.status === "已发布"
      ? "done"
      : listing.status === "基础通过"
        ? "warning"
        : "warning",
    listing.status === "可提交"
      ? "已达到可提交状态，可由运营提交到 Amazon"
      : listing.status === "提交中"
        ? "已提交到 Amazon，等待处理结果"
        : listing.status === "已发布"
          ? "Amazon 已确认发布"
          : listing.status === "基础通过"
            ? "本地检查通过，但需要管理员启用 Amazon 发布连接器后才能直连提交"
            : "保存后执行本地检查，系统会判断是否可提交",
    listing.status === "基础通过" ? "管理员" : "运营",
    listing.status === "基础通过" ? "在系统设置里配置并启用 Amazon SP-API" : undefined,
  ));
  sections.push({ id: "publish", title: "交付发布", checks: publishChecks });

  return {
    score: Math.max(0, Math.min(100, score)),
    blockers,
    suggestions,
    templateMissingCount,
    sections,
    nextActions: collectNextActions(sections),
  };
}
