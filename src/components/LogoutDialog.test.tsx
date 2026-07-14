import { createRef } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import LogoutDialog from "./LogoutDialog";
import type { EmployeeAccount } from "../types/domain";

const currentUser: EmployeeAccount = {
  id: "employee-1",
  username: "zhangning",
  name: "张宁",
  department: "Amazon 运营",
  role: "管理员",
  active: true,
  mustChangePassword: false,
};

function renderDialog(overrides: Partial<Parameters<typeof LogoutDialog>[0]> = {}) {
  const props = {
    currentUser,
    activeImageJobs: 2,
    signingOut: false,
    returnFocusRef: createRef<HTMLButtonElement>(),
    onCancel: vi.fn(),
    onConfirm: vi.fn(),
    ...overrides,
  };
  render(<LogoutDialog {...props} />);
  return props;
}

describe("LogoutDialog", () => {
  it("先说明退出影响，不会打开后立即退出", async () => {
    const props = renderDialog();

    expect(screen.getByRole("dialog", { name: "确认退出花彩工作台？" })).toBeInTheDocument();
    expect(screen.getByText("2 个后台生图任务会继续运行")).toBeInTheDocument();
    expect(props.onConfirm).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByRole("button", { name: "留在工作台" })).toHaveFocus());
  });

  it("支持取消、Esc 和明确确认", async () => {
    const user = userEvent.setup();
    const props = renderDialog();

    await user.keyboard("{Escape}");
    expect(props.onCancel).toHaveBeenCalledTimes(1);

    fireEvent.mouseDown(screen.getByTestId("logout-backdrop"));
    expect(props.onCancel).toHaveBeenCalledTimes(2);

    await user.click(screen.getByRole("button", { name: "确认退出" }));
    expect(props.onConfirm).toHaveBeenCalledTimes(1);
  });

  it("退出过程中锁定操作", () => {
    renderDialog({ signingOut: true });

    expect(screen.getByRole("button", { name: "留在工作台" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "正在安全退出…" })).toBeDisabled();
  });
});
