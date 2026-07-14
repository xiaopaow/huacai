import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import HelpCenterDialog from "./HelpCenterDialog";

describe("HelpCenterDialog", () => {
  it("按角色显示指南并能进入真实功能", async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();
    render(<HelpCenterDialog role="运营" onClose={vi.fn()} onNavigate={onNavigate} />);

    expect(screen.getByRole("dialog", { name: "运营使用指南" })).toBeInTheDocument();
    expect(screen.getByText("维护商品资料")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Listing 中心/ }));
    expect(onNavigate).toHaveBeenCalledWith("listings");
  });

  it("支持 Escape 关闭并自动聚焦关闭按钮", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<HelpCenterDialog role="设计" onClose={onClose} onNavigate={vi.fn()} />);

    await waitFor(() => expect(screen.getByRole("button", { name: "关闭帮助中心" })).toHaveFocus());
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
