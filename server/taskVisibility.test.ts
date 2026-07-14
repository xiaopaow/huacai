import { describe, expect, it } from "vitest";
import { visibleProductsForEmployee, visibleTasksForEmployee } from "./taskVisibility.js";
import type { WorkspaceProduct, WorkspaceTask } from "./types.js";

const tasks = [
  { id: "t1", productId: "p1", sku: "SKU-1", productName: "产品 1", type: "Amazon 六图套图", status: "待生成", progress: 0, owner: "张三", assignedToId: "designer-1", createdById: "ops-1", updatedAt: "刚刚" },
  { id: "t2", productId: "p2", sku: "SKU-2", productName: "产品 2", type: "Amazon 白底主图", status: "待审核", progress: 100, owner: "李四", assignedToId: "designer-2", createdById: "ops-1", updatedAt: "刚刚" },
  { id: "t3", productId: "p3", sku: "SKU-3", productName: "产品 3", type: "场景图", status: "已通过", progress: 100, owner: "李四", assignedToId: "designer-2", createdById: "designer-2", updatedAt: "刚刚" },
] satisfies WorkspaceTask[];

const products = [
  { id: "p1", sku: "SKU-1", name: "产品 1", brand: "花彩", category: "家居", marketplace: "美国站", status: "Active", imageCount: 0, updatedAt: "刚刚" },
  { id: "p2", sku: "SKU-2", name: "产品 2", brand: "花彩", category: "家居", marketplace: "美国站", status: "Active", imageCount: 0, updatedAt: "刚刚" },
  { id: "p3", sku: "SKU-3", name: "产品 3", brand: "花彩", category: "家居", marketplace: "美国站", status: "Active", imageCount: 0, updatedAt: "刚刚" },
] satisfies WorkspaceProduct[];

describe("task visibility", () => {
  it("lets admins and operators see the whole workspace", () => {
    expect(visibleTasksForEmployee(tasks, { id: "admin-1", role: "管理员" })).toHaveLength(3);
    expect(visibleTasksForEmployee(tasks, { id: "ops-1", role: "运营" })).toHaveLength(3);
  });

  it("limits designers to their assigned or created tasks", () => {
    expect(visibleTasksForEmployee(tasks, { id: "designer-1", role: "设计" }).map((task) => task.id)).toEqual(["t1"]);
    expect(visibleTasksForEmployee(tasks, { id: "designer-2", role: "设计" }).map((task) => task.id)).toEqual(["t2", "t3"]);
  });

  it("limits reviewers to tasks that are waiting for review", () => {
    const visibleTasks = visibleTasksForEmployee(tasks, { id: "reviewer-1", role: "审核" });
    expect(visibleTasks.map((task) => task.id)).toEqual(["t2"]);
    expect(visibleProductsForEmployee(products, visibleTasks, { role: "审核" }).map((product) => product.id)).toEqual(["p2"]);
  });
});
