import { describe, expect, it } from "vitest";
import { canAccessPage, firstAccessiblePage } from "./pageAccess";

describe("page access rules", () => {
  it("keeps AI creation and asset library away from reviewers", () => {
    expect(canAccessPage("审核", "reviews")).toBe(true);
    expect(canAccessPage("审核", "tasks")).toBe(true);
    expect(canAccessPage("审核", "create")).toBe(false);
    expect(canAccessPage("审核", "assets")).toBe(false);
    expect(firstAccessiblePage("审核")).toBe("reviews");
  });

  it("lets production roles access the pages they need", () => {
    expect(canAccessPage("运营", "products")).toBe(true);
    expect(canAccessPage("运营", "listings")).toBe(true);
    expect(canAccessPage("运营", "listingHistory")).toBe(true);
    expect(canAccessPage("设计", "assets")).toBe(true);
    expect(canAccessPage("设计", "listingHistory")).toBe(false);
    expect(canAccessPage("设计", "reviews")).toBe(false);
  });

  it("allows admins to access every page", () => {
    expect(canAccessPage("管理员", "performance")).toBe(true);
    expect(canAccessPage("管理员", "settings")).toBe(true);
    expect(firstAccessiblePage("管理员")).toBe("dashboard");
  });
});
