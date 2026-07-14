import type { Employee } from "./types.js";

export function visibleTeamDirectory(
  employees: Employee[],
  viewer: Pick<Employee, "id" | "role">,
) {
  const active = employees.filter((employee) => employee.active);
  if (viewer.role === "管理员" || viewer.role === "运营") {
    return active.filter((employee) => employee.role === "设计" || employee.role === "管理员");
  }
  return active.filter((employee) => employee.id === viewer.id);
}

export function publicTeamDirectoryEntry(employee: Pick<Employee, "id" | "name" | "department" | "role">) {
  const { id, name, department, role } = employee;
  return { id, name, department, role };
}
