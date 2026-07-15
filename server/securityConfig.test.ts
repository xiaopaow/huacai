import { describe, expect, it } from "vitest";
import { corsOriginAllowed, parseCorsOrigins, parseTrustProxy } from "./securityConfig.js";

describe("production security configuration", () => {
  it("normalizes and deduplicates explicit CORS origins", () => {
    expect(parseCorsOrigins("https://ops.example.com, https://ops.example.com/,http://192.168.1.9:8787"))
      .toEqual(["https://ops.example.com", "http://192.168.1.9:8787"]);
    expect(parseCorsOrigins("javascript:alert(1),not-a-url")).toEqual([]);
  });

  it("allows same-server requests and only configured browser origins", () => {
    const allowed = ["https://ops.example.com"];
    expect(corsOriginAllowed(undefined, allowed)).toBe(true);
    expect(corsOriginAllowed("https://ops.example.com", allowed)).toBe(true);
    expect(corsOriginAllowed("https://evil.example", allowed)).toBe(false);
  });

  it("accepts bounded proxy hop counts and safe named ranges", () => {
    expect(parseTrustProxy("1")).toBe(1);
    expect(parseTrustProxy("loopback")).toBe("loopback");
    expect(parseTrustProxy("true")).toBe(false);
    expect(parseTrustProxy("99")).toBe(false);
  });
});
