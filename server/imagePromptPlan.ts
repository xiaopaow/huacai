export interface PlannedImagePrompt {
  label: string;
  prompt: string;
}

interface PromptSection {
  label: string;
  lines: string[];
}

const sectionAliases: Array<{ label: string; aliases: string[] }> = [
  { label: "主图（白底）", aliases: ["主图", "主图白底", "白底主图", "白底图", "amazon主图", "amazon白底主图"] },
  { label: "场景图", aliases: ["场景图", "使用场景图", "生活场景图", "场景展示图"] },
  { label: "卖点图", aliases: ["卖点图", "功能卖点图", "功能图", "优势图"] },
  { label: "细节图", aliases: ["细节图", "产品细节图", "材质细节图", "工艺细节图"] },
  { label: "安装展示图", aliases: ["安装展示图", "安装图", "组装图", "安装步骤图", "组装步骤图"] },
  { label: "尺寸功能图", aliases: ["尺寸功能图", "尺寸图", "尺寸展示图", "规格图", "参数图"] },
  { label: "包装图", aliases: ["包装图", "包装展示图", "包装清单图", "配件清单图"] },
  { label: "对比图", aliases: ["对比图", "产品对比图", "前后对比图"] },
];

function normalizedHeading(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[\s:：\-—_、，,。.!！?？（）()【】\[\]]/g, "");
}

function sectionLabel(line: string) {
  const normalized = normalizedHeading(line);
  if (!normalized || normalized.length > 18) return undefined;
  return sectionAliases.find((candidate) => candidate.aliases.includes(normalized))?.label;
}

function splitPromptSections(prompt: string) {
  const preamble: string[] = [];
  const sections: PromptSection[] = [];
  let current: PromptSection | undefined;

  for (const rawLine of prompt.replace(/\r/g, "").split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;
    const label = sectionLabel(line);
    if (label) {
      current = { label, lines: [] };
      sections.push(current);
      continue;
    }
    if (current) current.lines.push(line);
    else preamble.push(line);
  }

  return { preamble, sections };
}

const standaloneImageRules = [
  "只生成 1 张完整、独立的成品图，整张画布只服务于一个明确用途。",
  "禁止拼贴、九宫格、分屏、故事板、联系表、画中画、多画框或在同一画布展示多套方案。",
  "保持参考商品的结构、比例、颜色、材质与关键细节一致，不要替换成其他商品。",
];

function composePrompt(common: string[], label: string, details: string[], index: number, count: number) {
  return [
    ...standaloneImageRules,
    common.length ? `共同商品要求：\n${common.join("\n")}` : "",
    `本次只制作套图中的第 ${index + 1}/${count} 张：${label}`,
    details.length ? `本张图片要求：\n${details.join("\n")}` : "",
    label === "安装展示图"
      ? "如需表达步骤，可在一个连续画面中使用少量编号或箭头标注，但不要拆成多个格子。"
      : "",
  ].filter(Boolean).join("\n\n");
}

/**
 * Turns a multi-image Amazon brief into one provider prompt per output image.
 * A structured six-image brief must never be repeated verbatim for every call,
 * otherwise image models tend to render the whole brief as a collage.
 */
export function buildImagePromptPlan(prompt: string, count: number): PlannedImagePrompt[] {
  const safeCount = Math.max(1, Math.min(7, Math.floor(count)));
  const { preamble, sections } = splitPromptSections(prompt.trim());

  if (sections.length) {
    return Array.from({ length: safeCount }, (_, index) => {
      const section = sections[index];
      if (section) {
        return {
          label: section.label,
          prompt: composePrompt(preamble, section.label, section.lines, index, safeCount),
        };
      }
      const label = `补充角度 ${index + 1}`;
      return {
        label,
        prompt: composePrompt(
          preamble,
          label,
          ["生成与前面用途不同的独立商品展示角度，突出真实使用价值，不要重复构图。"],
          index,
          safeCount,
        ),
      };
    });
  }

  return Array.from({ length: safeCount }, (_, index) => ({
    label: safeCount === 1 ? "单张商品图" : `独立变体 ${index + 1}`,
    prompt: [
      ...standaloneImageRules,
      prompt.trim(),
      safeCount > 1
        ? `这是 ${safeCount} 张独立输出中的第 ${index + 1} 张，请采用不同于其他输出的构图或拍摄角度；仍然只输出一张单图。`
        : "",
    ].filter(Boolean).join("\n\n"),
  }));
}
