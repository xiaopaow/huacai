import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getAssetObjectUrl, getGeneratedImagePage, type GeneratedImage } from "../lib/api";
import type { EmployeeAccount } from "../types/domain";
import GeneratedHistoryPage from "./GeneratedHistoryPage";

vi.mock("../lib/api", () => ({
  getAssetObjectUrl: vi.fn(),
  getGeneratedImagePage: vi.fn(),
}));

const currentUser: EmployeeAccount = {
  id: "employee-1",
  username: "operator",
  name: "张宁",
  department: "Amazon 运营",
  role: "运营",
  active: true,
  mustChangePassword: false,
};

const generatedImage: GeneratedImage = {
  id: "history-1.png",
  url: "/api/assets/images/history-1.png",
  model: "openai/gpt-image-2",
  size: "1024x1024",
  quality: "medium",
  prompt: "明亮厨房台面，棉麻抹布擦拭水迹，真实自然光。",
  ratio: "1:1",
  templateTitle: "厨房场景图",
  ownerId: currentUser.id,
  ownerName: currentUser.name,
  createdAt: "2026-07-09T08:00:00.000Z",
};

describe("GeneratedHistoryPage", () => {
  beforeEach(() => {
    vi.mocked(getGeneratedImagePage).mockResolvedValue({
      items: [generatedImage],
      total: 1,
      offset: 0,
      nextOffset: 1,
      hasMore: false,
    });
    vi.mocked(getAssetObjectUrl).mockResolvedValue("data:image/png;base64,abc");
  });

  it("展示历史作品并支持复用提示词", async () => {
    const user = userEvent.setup();
    const onReusePrompt = vi.fn();

    render(<GeneratedHistoryPage currentUser={currentUser} notify={vi.fn()} onReusePrompt={onReusePrompt} />);

    expect(await screen.findByText("厨房场景图")).toBeInTheDocument();
    expect(screen.getByText(/明亮厨房台面/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "复用提示词" }));

    expect(onReusePrompt).toHaveBeenCalledWith(expect.objectContaining({
      id: generatedImage.id,
      prompt: generatedImage.prompt,
      ratio: generatedImage.ratio,
      quality: generatedImage.quality,
    }));
  });

  it("支持打开大图预览并下载原图", async () => {
    const user = userEvent.setup();

    render(<GeneratedHistoryPage currentUser={currentUser} notify={vi.fn()} />);

    await screen.findByText("厨房场景图");
    await user.click(screen.getByRole("button", { name: "大图" }));

    await waitFor(() => expect(screen.getByRole("heading", { name: "厨房场景图" })).toBeInTheDocument());
    expect(await screen.findByRole("link", { name: /下载原图/ })).toHaveAttribute("download");
  });
});
