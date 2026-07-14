import { describe, expect, it } from "vitest";
import { isValidUsername, validateEmployeeUpdate } from "./employeeRules.js";
import type { Employee } from "./types.js";

function employee(id: string, role: Employee["role"] = "运营"): Employee {
  return {
    id,
    username: id,
    passwordHash: "hash",
    name: id,
    department: "运营",
    role,
    active: true,
  };
}

describe("员工账号修改规则", () => {
  it("限制用户名格式并检查重复", () => {
    expect(isValidUsername("user.name-01")).toBe(true);
    expect(isValidUsername("中文 用户")).toBe(false);
    const target = employee("target");
    const result = validateEmployeeUpdate(target, { username: "ADMIN" }, [target, employee("admin")], "admin");
    expect(result.error).toBe("用户名已经存在");
  });

  it("禁止管理员停用自己或移除自己的管理员角色", () => {
    const admin = employee("admin", "管理员");
    expect(validateEmployeeUpdate(admin, { active: false }, [admin], admin.id).error).toContain("不能停用自己");
    expect(validateEmployeeUpdate(admin, { role: "运营" }, [admin], admin.id).error).toContain("不能停用自己");
  });

  it("始终保留至少一个启用管理员", () => {
    const admin = employee("admin", "管理员");
    const operator = employee("operator");
    expect(validateEmployeeUpdate(admin, { active: false }, [admin, operator], operator.id).error).toContain("至少保留一个");
    const secondAdmin = employee("admin-2", "管理员");
    expect(validateEmployeeUpdate(admin, { active: false }, [admin, secondAdmin], secondAdmin.id).patch).toEqual({ active: false });
  });

  it("规范姓名、部门和用户名空格", () => {
    const target = employee("target");
    const result = validateEmployeeUpdate(target, {
      username: " designer.01 ",
      name: " 林晓 ",
      department: " 视觉设计 ",
    }, [target, employee("admin", "管理员")], "admin");
    expect(result.patch).toMatchObject({ username: "designer.01", name: "林晓", department: "视觉设计" });
  });
});
