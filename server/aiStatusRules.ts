import type { Employee } from "./types.js";

export interface InternalAiStatus {
  configured: boolean;
  model: string;
  proxyConfigured: boolean;
  lastFailure: { code: string; at: string } | null;
}

export function publicAiStatusForEmployee(status: InternalAiStatus, viewer: Pick<Employee, "role">) {
  if (viewer.role === "管理员") return status;

  return {
    configured: status.configured,
    model: status.configured ? "AI 生图服务" : "",
    proxyConfigured: false,
    lastFailure: status.lastFailure?.code === "billing_hard_limit_reached"
      ? status.lastFailure
      : null,
  };
}
