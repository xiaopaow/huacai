import type { Employee, WorkspaceProduct, WorkspaceTask } from "./types.js";

export function visibleTasksForEmployee(tasks: WorkspaceTask[], employee: Pick<Employee, "id" | "role">) {
  if (employee.role === "管理员" || employee.role === "运营") return tasks;
  if (employee.role === "设计") {
    return tasks.filter((task) =>
      task.assignedToId === employee.id
      || task.createdById === employee.id
      || (!task.assignedToId && task.status !== "已通过"),
    );
  }
  return tasks.filter((task) => task.status === "待审核");
}

export function visibleProductsForEmployee(
  products: WorkspaceProduct[],
  visibleTasks: WorkspaceTask[],
  employee: Pick<Employee, "role">,
) {
  if (employee.role === "管理员" || employee.role === "运营" || employee.role === "设计") return products;
  const productIds = new Set(visibleTasks.map((task) => task.productId));
  return products.filter((product) => productIds.has(product.id));
}
