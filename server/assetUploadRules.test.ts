import { describe, expect, it } from "vitest";
import { validateAssetUploadContext } from "./assetUploadRules.js";
import type { Employee, WorkspaceProduct, WorkspaceTask } from "./types.js";

const product: WorkspaceProduct = {
  id: "product-1",
  sku: "HC-001",
  name: "Wall Art",
  brand: "Huacai",
  category: "Home",
  marketplace: "美国站",
  status: "可生成",
  imageCount: 0,
  updatedAt: "刚刚",
};

const task: WorkspaceTask = {
  id: "TASK-123456",
  productId: product.id,
  sku: product.sku,
  productName: product.name,
  type: "Amazon 六图套图",
  status: "待生成",
  progress: 0,
  owner: "林晓",
  assignedToId: "designer-1",
  updatedAt: "刚刚",
};

const designer: Pick<Employee, "id" | "role"> = { id: "designer-1", role: "设计" };
const operator: Pick<Employee, "id" | "role"> = { id: "operator-1", role: "运营" };
const reviewer: Pick<Employee, "id" | "role"> = { id: "reviewer-1", role: "审核" };

describe("asset upload rules", () => {
  it("allows studio reference uploads only with a studio task id", () => {
    expect(validateAssetUploadContext({
      purpose: "reference",
      taskId: "studio-1780000000000",
      productId: "",
      employee: designer,
      products: [product],
      tasks: [task],
    }).status).toBe(200);

    expect(validateAssetUploadContext({
      purpose: "reference",
      taskId: "TASK-123456",
      productId: product.id,
      employee: designer,
      products: [product],
      tasks: [task],
    }).status).toBe(400);
  });

  it("allows operators and designers to upload input images for a real product", () => {
    expect(validateAssetUploadContext({
      purpose: "input",
      taskId: "TASK-NEW-1",
      productId: product.id,
      employee: operator,
      products: [product],
      tasks: [],
    }).status).toBe(200);

    expect(validateAssetUploadContext({
      purpose: "input",
      taskId: "TASK-NEW-1",
      productId: product.id,
      employee: reviewer,
      products: [product],
      tasks: [],
    }).status).toBe(403);
  });

  it("allows output uploads only for the assigned designer or admin-valid task", () => {
    expect(validateAssetUploadContext({
      purpose: "output",
      taskId: task.id,
      productId: product.id,
      employee: designer,
      products: [product],
      tasks: [task],
    }).status).toBe(200);

    expect(validateAssetUploadContext({
      purpose: "output",
      taskId: task.id,
      productId: product.id,
      employee: { id: "designer-2", role: "设计" },
      products: [product],
      tasks: [task],
    }).status).toBe(403);
  });
});
