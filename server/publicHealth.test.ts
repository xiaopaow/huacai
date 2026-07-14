import { describe, expect, it } from "vitest";
import { publicHealthResponse } from "./publicHealth.js";

describe("public health response", () => {
  it("does not expose internal database or integration configuration", () => {
    expect(publicHealthResponse()).toEqual({ ok: true, service: "huacai" });
    expect(publicHealthResponse()).not.toHaveProperty("database");
    expect(publicHealthResponse()).not.toHaveProperty("amazonConfigured");
  });
});
