import type { Employee } from "./types.js";

export type EmployeeUpdateInput = Partial<Pick<Employee, "username" | "name" | "department" | "role" | "active">>;

export function isValidUsername(username: string) {
  return /^[A-Za-z0-9._-]{3,40}$/.test(username);
}

export function validateEmployeeUpdate(
  employee: Employee,
  input: EmployeeUpdateInput,
  employees: Employee[],
  operatorId: string,
): { patch?: EmployeeUpdateInput; error?: string } {
  const patch: EmployeeUpdateInput = {};

  if (input.username !== undefined) {
    const username = input.username.trim();
    if (!isValidUsername(username)) return { error: "用户名需为 3–40 位字母、数字、点、下划线或短横线" };
    if (employees.some((item) => item.id !== employee.id && item.username.toLowerCase() === username.toLowerCase())) {
      return { error: "用户名已经存在" };
    }
    patch.username = username;
  }
  if (input.name !== undefined) {
    const name = input.name.trim();
    if (!name) return { error: "姓名不能为空" };
    patch.name = name;
  }
  if (input.department !== undefined) {
    const department = input.department.trim();
    if (!department) return { error: "部门不能为空" };
    patch.department = department;
  }
  if (input.role !== undefined) {
    if (!["管理员", "运营", "设计", "审核"].includes(input.role)) return { error: "账号角色无效" };
    patch.role = input.role;
  }
  if (input.active !== undefined) patch.active = Boolean(input.active);

  if (employee.id === operatorId && (patch.active === false || (patch.role && patch.role !== "管理员"))) {
    return { error: "不能停用自己或移除自己的管理员角色" };
  }
  const removesActiveAdmin = employee.active
    && employee.role === "管理员"
    && (patch.active === false || (patch.role !== undefined && patch.role !== "管理员"));
  const activeAdminCount = employees.filter((item) => item.active && item.role === "管理员").length;
  if (removesActiveAdmin && activeAdminCount <= 1) return { error: "系统必须至少保留一个启用的管理员账号" };

  return { patch };
}
