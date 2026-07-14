import { describe, expect, it } from "vitest";
import {
  canViewGeneratedAsset,
  canViewUploadedAsset,
  publicAssetOwnerName,
  visibleGeneratedAssetsForEmployee,
} from "./assetVisibility.js";
import type { Employee, GeneratedAsset, UploadedAssetRecord, WorkspaceTask } from "./types.js";

const designer: Pick<Employee, "id" | "role" | "name"> = { id: "designer-1", role: "设计", name: "林晓" };
const reviewer: Pick<Employee, "id" | "role" | "name"> = { id: "reviewer-1", role: "审核", name: "陈璐" };
const operator: Pick<Employee, "id" | "role" | "name"> = { id: "ops-1", role: "运营", name: "张宁" };
const admin: Pick<Employee, "id" | "role" | "name"> = { id: "admin-1", role: "管理员", name: "管理员" };

const tasks = [
  {
    id: "task-1",
    productId: "p1",
    sku: "SKU-1",
    productName: "产品 1",
    type: "Amazon 六图套图",
    status: "待审核",
    progress: 100,
    owner: "林晓",
    assignedToId: designer.id,
    outputAssetIds: ["gen-review", "upload-output"],
    inputAssetIds: ["upload-input"],
    updatedAt: "刚刚",
  },
  {
    id: "task-2",
    productId: "p2",
    sku: "SKU-2",
    productName: "产品 2",
    type: "场景图",
    status: "待生成",
    progress: 0,
    owner: "其他设计",
    assignedToId: "designer-2",
    outputAssetIds: ["gen-private"],
    updatedAt: "刚刚",
  },
] satisfies WorkspaceTask[];

const generated = [
  { id: "gen-review", ownerId: designer.id, prompt: "审核图", ratio: "1:1", quality: "medium", model: "gpt-image-2", size: "1024x1024", referenceCount: 0, createdAt: "2026-01-01T00:00:00.000Z" },
  { id: "gen-private", ownerId: "designer-2", prompt: "其他图", ratio: "1:1", quality: "medium", model: "gpt-image-2", size: "1024x1024", referenceCount: 0, createdAt: "2026-01-02T00:00:00.000Z" },
] satisfies GeneratedAsset[];

describe("asset visibility", () => {
  it("lets reviewers see only assets attached to pending review tasks", () => {
    expect(canViewGeneratedAsset(generated[0], tasks, reviewer)).toBe(true);
    expect(canViewGeneratedAsset(generated[1], tasks, reviewer)).toBe(false);
    expect(visibleGeneratedAssetsForEmployee(generated, tasks, reviewer).map((asset) => asset.id)).toEqual(["gen-review"]);
  });

  it("lets designers see their own generated assets and assigned task uploads", () => {
    const input: UploadedAssetRecord = {
      id: "upload-input",
      ownerId: operator.id,
      name: "input.jpg",
      type: "image/jpeg",
      size: 100,
      taskId: "task-1",
      productId: "p1",
      purpose: "input",
      createdAt: "2026-01-01T00:00:00.000Z",
    };
    const reference: UploadedAssetRecord = { ...input, id: "reference-1", purpose: "reference" };

    expect(canViewUploadedAsset(input, tasks, designer)).toBe(true);
    expect(canViewUploadedAsset(reference, tasks, designer)).toBe(false);
    expect(canViewGeneratedAsset(generated[0], tasks, designer)).toBe(true);
  });

  it("allows operators and admins to reuse team assets but hides owner names from non-admin peers", () => {
    expect(visibleGeneratedAssetsForEmployee(generated, tasks, operator)).toHaveLength(2);
    expect(visibleGeneratedAssetsForEmployee(generated, tasks, admin)).toHaveLength(2);
    expect(publicAssetOwnerName({ id: designer.id, name: designer.name }, operator)).toBe("团队成员");
    expect(publicAssetOwnerName({ id: designer.id, name: designer.name }, admin)).toBe(designer.name);
  });
});
