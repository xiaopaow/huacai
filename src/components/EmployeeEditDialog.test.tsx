import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import EmployeeEditDialog from "./EmployeeEditDialog";
import type { EmployeeAccount } from "../types/domain";

const employee: EmployeeAccount = {
  id: "employee-1",
  username: "designer",
  name: "林晓",
  department: "视觉设计",
  role: "设计",
  active: true,
};

describe("EmployeeEditDialog", () => {
  it("可修改用户名、姓名、部门和角色", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<EmployeeEditDialog employee={employee} isCurrentUser={false} onClose={vi.fn()} onSave={onSave} />);

    await user.clear(screen.getByRole("textbox", { name: /用户名/ }));
    await user.type(screen.getByRole("textbox", { name: /用户名/ }), "company.designer");
    await user.clear(screen.getByRole("textbox", { name: "姓名" }));
    await user.type(screen.getByRole("textbox", { name: "姓名" }), "王美工");
    await user.clear(screen.getByRole("textbox", { name: "部门" }));
    await user.type(screen.getByRole("textbox", { name: "部门" }), "品牌视觉部");
    await user.selectOptions(screen.getByRole("combobox", { name: "角色" }), "审核");
    await user.click(screen.getByRole("button", { name: "保存员工资料" }));

    expect(onSave).toHaveBeenCalledWith({
      username: "company.designer",
      name: "王美工",
      department: "品牌视觉部",
      role: "审核",
    });
  });

  it("编辑自己时锁定角色但允许更新资料", () => {
    render(<EmployeeEditDialog employee={{ ...employee, role: "管理员" }} isCurrentUser onClose={vi.fn()} onSave={vi.fn()} />);
    expect(screen.getByRole("combobox", { name: /^角色/ })).toBeDisabled();
    expect(screen.getByRole("textbox", { name: /用户名/ })).toBeEnabled();
  });
});
