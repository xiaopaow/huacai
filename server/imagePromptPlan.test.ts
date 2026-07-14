import { describe, expect, it } from "vitest";
import { buildImagePromptPlan } from "./imagePromptPlan.js";

const sixImageBrief = `给你的合成器支架参考图
主图（白底）
产品居中
高级木纹质感
场景图
音乐工作桌面
搭配合成器使用
卖点图
双层结构
节省桌面空间
细节图
实木纹理
防滑垫
安装展示图
零件拆解
安装步骤
尺寸功能图
尺寸标注
适配 Volca 系列`;

describe("buildImagePromptPlan", () => {
  it("splits an Amazon suite brief into independent single-image prompts", () => {
    const plan = buildImagePromptPlan(sixImageBrief, 6);

    expect(plan.map((item) => item.label)).toEqual([
      "主图（白底）",
      "场景图",
      "卖点图",
      "细节图",
      "安装展示图",
      "尺寸功能图",
    ]);
    expect(plan[0].prompt).toContain("产品居中");
    expect(plan[0].prompt).not.toContain("音乐工作桌面");
    expect(plan[1].prompt).toContain("音乐工作桌面");
    expect(plan[1].prompt).not.toContain("双层结构");
    expect(plan.every((item) => item.prompt.includes("禁止拼贴"))).toBe(true);
  });

  it("adds a standalone-image guard to ordinary multi-output prompts", () => {
    const plan = buildImagePromptPlan("木质支架，音乐工作室场景", 3);

    expect(plan).toHaveLength(3);
    expect(plan[2].prompt).toContain("第 3 张");
    expect(plan[2].prompt).toContain("只输出一张单图");
  });
});
