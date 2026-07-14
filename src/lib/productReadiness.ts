import type { Product } from "../types/domain";

export type ProductReadinessTone = "ready" | "warning" | "danger";

export interface ProductReadinessIssue {
  key: string;
  label: string;
  detail: string;
  severity: "required" | "recommended";
}

export interface ProductReadinessOptions {
  /**
   * When creating a task, use the images uploaded for this task instead of
   * historical product.imageCount. On the product list, leave it empty so the
   * product's saved image count is used.
   */
  referenceImageCount?: number;
  minReferenceImages?: number;
}

export interface ProductReadiness {
  score: number;
  label: string;
  tone: ProductReadinessTone;
  issues: ProductReadinessIssue[];
  requiredIssues: ProductReadinessIssue[];
  recommendedIssues: ProductReadinessIssue[];
  referenceImageCount: number;
}

function hasValue(value: unknown) {
  return String(value ?? "").trim().length > 0;
}

function clampScore(score: number) {
  return Math.max(0, Math.min(100, Math.round(score)));
}

export function evaluateProductReadiness(
  product: Pick<Product, "sku" | "asin" | "name" | "brand" | "category" | "marketplace" | "imageCount">,
  options: ProductReadinessOptions = {},
): ProductReadiness {
  const referenceImageCount = Math.max(
    0,
    Math.floor(Number(options.referenceImageCount ?? product.imageCount) || 0),
  );
  const minReferenceImages = Math.max(1, Math.floor(Number(options.minReferenceImages ?? 1) || 1));
  const issues: ProductReadinessIssue[] = [];
  let score = 100;

  const requiredChecks: Array<{
    key: string;
    ok: boolean;
    penalty: number;
    label: string;
    detail: string;
  }> = [
    { key: "sku", ok: hasValue(product.sku), penalty: 20, label: "缺少 SKU", detail: "运营和美工都需要用 SKU 串联任务、素材和 Listing。" },
    { key: "name", ok: hasValue(product.name), penalty: 18, label: "缺少商品名称", detail: "商品名称会进入任务标题、审核记录和 Listing 草稿。" },
    { key: "brand", ok: hasValue(product.brand), penalty: 16, label: "缺少品牌", detail: "品牌会影响主图风格、Listing 品牌字段和合规检查。" },
    { key: "category", ok: hasValue(product.category), penalty: 14, label: "缺少 Amazon 类目", detail: "类目会影响后续亚马逊上传模板字段。" },
    { key: "marketplace", ok: hasValue(product.marketplace), penalty: 12, label: "缺少目标站点", detail: "不同站点会影响语言、尺寸、合规和模板字段。" },
  ];

  for (const check of requiredChecks) {
    if (check.ok) continue;
    score -= check.penalty;
    issues.push({
      key: check.key,
      label: check.label,
      detail: check.detail,
      severity: "required",
    });
  }

  if (!hasValue(product.asin)) {
    score -= 6;
    issues.push({
      key: "asin",
      label: "未填写 ASIN",
      detail: "已有在售链接时建议填写；新品可先留空，后续上传模板再补充 GTIN/豁免信息。",
      severity: "recommended",
    });
  }

  if (referenceImageCount <= 0) {
    score -= 16;
    issues.push({
      key: "reference-images",
      label: "未添加商品原图",
      detail: "建议至少上传主图、角度图和细节图，减少美工二次索要资料。",
      severity: "recommended",
    });
  } else if (referenceImageCount < minReferenceImages) {
    score -= 8;
    issues.push({
      key: "reference-images-count",
      label: `原图少于 ${minReferenceImages} 张`,
      detail: "六图套图最好有多个角度和细节参考，生成结果会更稳定。",
      severity: "recommended",
    });
  }

  const normalizedScore = clampScore(score);
  const requiredIssues = issues.filter((issue) => issue.severity === "required");
  const recommendedIssues = issues.filter((issue) => issue.severity === "recommended");
  const tone: ProductReadinessTone =
    requiredIssues.length || normalizedScore < 65 ? "danger" : normalizedScore < 90 ? "warning" : "ready";
  const label =
    tone === "ready" ? "资料完整" : tone === "warning" ? "建议补充" : "资料不足";

  return {
    score: normalizedScore,
    label,
    tone,
    issues,
    requiredIssues,
    recommendedIssues,
    referenceImageCount,
  };
}
