import { taskSubmissionError } from "./taskRules.js";
import type { Employee, WorkspaceProduct, WorkspaceTask } from "./types.js";

export type AssetPurpose = "input" | "output" | "reference";

export interface AssetUploadContextInput {
  purpose: AssetPurpose;
  taskId: string;
  productId: string;
  employee: Pick<Employee, "id" | "role">;
  products: WorkspaceProduct[];
  tasks: WorkspaceTask[];
}

export interface AssetUploadContextResult {
  status: number;
  error?: string;
}

export function validateAssetUploadContext(input: AssetUploadContextInput): AssetUploadContextResult {
  if (input.purpose === "reference") {
    if (!/^studio-\d{8,}$/.test(input.taskId) || input.productId) {
      return { status: 400, error: "参考图只能通过素材创作台上传，请刷新页面后重试" };
    }
    return { status: 200 };
  }

  if (!/^[A-Za-z0-9-]{6,64}$/.test(input.taskId)) {
    return { status: 400, error: "图片关联的任务编号无效，请重新上传" };
  }

  const product = input.products.find((item) => item.id === input.productId);
  if (!product) {
    return { status: 404, error: "图片关联的 SKU 商品不存在，请刷新商品库后重试" };
  }

  if (input.purpose === "input") {
    if (!["管理员", "运营", "设计"].includes(input.employee.role)) {
      return { status: 403, error: "当前账号不能上传商品原图" };
    }
    return { status: 200 };
  }

  const task = input.tasks.find((item) => item.id === input.taskId);
  if (!task) {
    return { status: 404, error: "成品图关联的任务不存在，请刷新任务中心后重试" };
  }
  if (task.productId !== product.id) {
    return { status: 400, error: "成品图关联的任务与 SKU 不匹配，请重新打开任务后上传" };
  }
  if (!["管理员", "设计"].includes(input.employee.role)) {
    return { status: 403, error: "当前账号不能上传成品图" };
  }
  const submissionError = taskSubmissionError(task, input.employee);
  if (submissionError) {
    return { status: task.status === "待审核" || task.status === "已通过" ? 409 : 403, error: submissionError };
  }

  return { status: 200 };
}
