import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AssetsPage from "./AssetsPage";
import { createImageJob, getAssetObjectUrl, getGeneratedImages, getImageJobs } from "../lib/api";
import type { EmployeeAccount } from "../types/domain";

vi.mock("../lib/api", () => ({
  createImageJob: vi.fn(),
  deleteAsset: vi.fn(),
  deleteAssets: vi.fn(),
  deleteImageJob: vi.fn(),
  getAiStatus: vi.fn().mockResolvedValue({ configured: true, model: "gpt-image-1", lastFailure: null }),
  getAssetObjectUrl: vi.fn(),
  getGeneratedImages: vi.fn().mockResolvedValue([]),
  getImageJobs: vi.fn().mockResolvedValue([]),
  retryImageJob: vi.fn(),
  uploadTaskImages: vi.fn().mockResolvedValue([]),
}));

const currentUser: EmployeeAccount = {
  id: "employee-1",
  username: "designer",
  name: "花彩美工",
  department: "视觉设计",
  role: "设计",
  active: true,
  mustChangePassword: false,
};

describe("AssetsPage 做同款", () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem(
      `huacai-studio-draft:${currentUser.id}`,
      JSON.stringify({ prompt: "", ratio: "3:4", quality: "medium", count: 3 }),
    );
    vi.mocked(getGeneratedImages).mockResolvedValue([]);
    vi.mocked(getImageJobs).mockResolvedValue([]);
    vi.mocked(getAssetObjectUrl).mockResolvedValue("");
    vi.mocked(createImageJob).mockResolvedValue({
      id: "job-1",
      ownerId: currentUser.id,
      ownerName: currentUser.name,
      status: "queued",
      progress: 0,
      prompt: "商品摄影提示词",
      ratio: "1:1",
      quality: "medium",
      count: 1,
      referenceAssetIds: [],
      attempts: 0,
      createdAt: "2026-07-02T00:00:00.000Z",
      updatedAt: "2026-07-02T00:00:00.000Z",
    });
  });

  it("后台生成作品在素材库显示生成历史入口", async () => {
    const user = userEvent.setup();
    const onOpenHistory = vi.fn();
    vi.mocked(getGeneratedImages).mockResolvedValue([{
      id: "result-1.png",
      url: "/api/assets/images/result-1.png",
      model: "gpt-image-1",
      size: "1024x1024",
      quality: "medium",
      prompt: "商品图",
      ratio: "1:1",
      ownerId: currentUser.id,
      ownerName: currentUser.name,
      createdAt: "2026-07-02T00:00:00.000Z",
    }]);
    vi.mocked(getAssetObjectUrl).mockResolvedValue("data:image/png;base64,abc");
    vi.mocked(getImageJobs).mockResolvedValue([{
      id: "job-locked",
      ownerId: currentUser.id,
      ownerName: currentUser.name,
      status: "succeeded",
      progress: 100,
      prompt: "商品图",
      ratio: "1:1",
      quality: "medium",
      referenceAssetIds: [],
      resultAssetId: "result-1.png",
      attempts: 1,
      createdAt: "2026-07-02T00:00:00.000Z",
      updatedAt: "2026-07-02T00:01:00.000Z",
    }]);

    render(<AssetsPage currentUser={currentUser} notify={vi.fn()} onOpenHistory={onOpenHistory} />);

    expect(await screen.findByText("已保存 1 张历史作品")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "删除" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /查看生成历史/ }));
    expect(onOpenHistory).toHaveBeenCalledTimes(1);
  });

  it("在素材页原地载入提示词并可一键提交生图", async () => {
    const user = userEvent.setup();
    const notify = vi.fn();
    render(<AssetsPage currentUser={currentUser} notify={notify} />);

    const sameStyleButtons = await screen.findAllByRole("button", { name: /做同款/ });
    await user.click(sameStyleButtons[0]);

    const prompt = screen.getByRole("textbox", { name: "图片生成提示词" });
    await waitFor(() => expect(prompt).toHaveFocus());
    expect(prompt).not.toHaveValue("");
    expect(screen.getByRole("combobox", { name: "画面比例" })).toHaveValue("1:1");
    expect(screen.getByRole("combobox", { name: "生成数量" })).toHaveValue("1");
    expect(screen.getByRole("heading", { name: "从灵感模板开始创作" })).toBeInTheDocument();
    expect(notify).toHaveBeenCalledWith(expect.stringContaining("即可一键生成"));

    await user.click(screen.getByRole("button", { name: /一键生成/ }));
    await waitFor(() => expect(createImageJob).toHaveBeenCalledTimes(1));
    expect(createImageJob).toHaveBeenCalledWith(expect.objectContaining({
      prompt: expect.any(String),
      count: 1,
      templateId: expect.any(String),
      templateTitle: expect.any(String),
    }));
  });
});
