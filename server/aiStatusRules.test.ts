import { describe, expect, it } from "vitest";
import { publicAiStatusForEmployee, type InternalAiStatus } from "./aiStatusRules.js";

const status: InternalAiStatus = {
  configured: true,
  model: "gpt-image-internal",
  proxyConfigured: true,
  lastFailure: { code: "server_error", at: "2026-07-06T00:00:00.000Z" },
};

describe("AI status visibility", () => {
  it("shows full AI diagnostics to admins", () => {
    expect(publicAiStatusForEmployee(status, { role: "管理员" })).toEqual(status);
  });

  it("hides model, proxy and internal failure details from regular employees", () => {
    expect(publicAiStatusForEmployee(status, { role: "设计" })).toEqual({
      configured: true,
      model: "AI 生图服务",
      proxyConfigured: false,
      lastFailure: null,
    });
  });

  it("keeps billing limit visible so employees know why generation is unavailable", () => {
    const billing = {
      ...status,
      lastFailure: { code: "billing_hard_limit_reached", at: "2026-07-06T00:00:00.000Z" },
    };
    expect(publicAiStatusForEmployee(billing, { role: "运营" }).lastFailure).toEqual(billing.lastFailure);
  });
});
