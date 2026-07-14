import { describe, expect, it } from "vitest";
import { canAccessImageJob, canCreateImageGenerationJob, hasInvalidOwnedReferenceAsset } from "./imageJobRules.js";
import type { Employee, ImageGenerationJob } from "./types.js";

const job = (ownerId = "designer-1"): Pick<ImageGenerationJob, "ownerId"> => ({ ownerId });
const employee = (id: string, role: Employee["role"]): Pick<Employee, "id" | "role"> => ({ id, role });

describe("image job access rules", () => {
  it("lets owners and admins access image generation jobs", () => {
    expect(canAccessImageJob(job(), employee("designer-1", "设计"))).toBe(true);
    expect(canAccessImageJob(job(), employee("admin-1", "管理员"))).toBe(true);
  });

  it("blocks other employees from accessing image generation jobs", () => {
    expect(canAccessImageJob(job(), employee("designer-2", "设计"))).toBe(false);
    expect(canAccessImageJob(job(), employee("operator-1", "运营"))).toBe(false);
    expect(canAccessImageJob(job(), employee("reviewer-1", "审核"))).toBe(false);
  });

  it("allows only production roles to create image generation jobs", () => {
    expect(canCreateImageGenerationJob(employee("admin-1", "管理员"))).toBe(true);
    expect(canCreateImageGenerationJob(employee("operator-1", "运营"))).toBe(true);
    expect(canCreateImageGenerationJob(employee("designer-1", "设计"))).toBe(true);
    expect(canCreateImageGenerationJob(employee("reviewer-1", "审核"))).toBe(false);
  });

  it("rejects missing or cross-employee reference images", () => {
    const uploadedAssets = [
      { id: "own.png", ownerId: "designer-1" },
      { id: "other.png", ownerId: "designer-2" },
    ];
    expect(hasInvalidOwnedReferenceAsset(["own.png"], uploadedAssets, "designer-1")).toBe(false);
    expect(hasInvalidOwnedReferenceAsset(["missing.png"], uploadedAssets, "designer-1")).toBe(true);
    expect(hasInvalidOwnedReferenceAsset(["other.png"], uploadedAssets, "designer-1")).toBe(true);
  });
});
