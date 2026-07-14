import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { JSONFilePreset } from "lowdb/node";
import bcrypt from "bcryptjs";
import { dedupeLocalListingDrafts } from "./listingRules.js";
import type { DatabaseSchema } from "./types.js";

const dataDirectory = join(process.cwd(), "data");
await mkdir(dataDirectory, { recursive: true });
const initialAdminPassword = process.env.INITIAL_ADMIN_PASSWORD ?? "ChangeMe123!";
const initialEmployeePassword = process.env.INITIAL_EMPLOYEE_PASSWORD ?? "Employee123!";

const defaultData: DatabaseSchema = {
  employees: [
    { id: "emp-zhang", username: "admin", passwordHash: bcrypt.hashSync(initialAdminPassword, 10), name: "张宁", department: "Amazon 运营", role: "管理员", active: true, mustChangePassword: true },
  ],
  sessions: [],
  activities: [],
  listings: [],
  listingGenerations: [],
  generatedAssets: [],
  uploadedAssets: [],
  products: [],
  tasks: [],
  imageJobs: [],
  notifications: [],
};

export const db = await JSONFilePreset<DatabaseSchema>(
  join(dataDirectory, "huacai-db.json"),
  defaultData,
);

let migrated = false;
if (!Array.isArray(db.data.listingGenerations)) {
  db.data.listingGenerations = [];
  migrated = true;
}
if (!Array.isArray(db.data.sessions)) {
  db.data.sessions = [];
  migrated = true;
}
if (!Array.isArray(db.data.generatedAssets)) {
  db.data.generatedAssets = [];
  migrated = true;
}
if (!Array.isArray(db.data.uploadedAssets)) {
  db.data.uploadedAssets = [];
  migrated = true;
}
if (!Array.isArray(db.data.products)) {
  db.data.products = [];
  migrated = true;
}
if (!Array.isArray(db.data.tasks)) {
  db.data.tasks = [];
  migrated = true;
}
if (!Array.isArray(db.data.imageJobs)) {
  db.data.imageJobs = [];
  migrated = true;
}
if (!Array.isArray(db.data.notifications)) {
  db.data.notifications = [];
  migrated = true;
}
for (const asset of db.data.uploadedAssets) {
  if (asset.purpose) continue;
  const task = db.data.tasks.find((item) => item.id === asset.taskId);
  asset.purpose = task?.outputAssetIds?.includes(asset.id)
    ? "output"
    : task?.inputAssetIds?.includes(asset.id)
      ? "input"
      : asset.taskId.startsWith("studio-")
        ? "reference"
        : "input";
  migrated = true;
}
for (const asset of db.data.generatedAssets) {
  if (asset.ownerName) continue;
  asset.ownerName = db.data.employees.find((employee) => employee.id === asset.ownerId)?.name ?? "历史账号";
  migrated = true;
}
for (const job of db.data.imageJobs) {
  if (!job.count) {
    job.count = 1;
    migrated = true;
  }
  if (job.resultAssetId && !Array.isArray(job.resultAssetIds)) {
    job.resultAssetIds = [job.resultAssetId];
    migrated = true;
  }
  if (job.status === "running") {
    job.status = "queued";
    job.progress = 0;
    job.updatedAt = new Date().toISOString();
    migrated = true;
  }
}
const legacyAccounts: Record<string, { username: string; password: string }> = {
  "emp-zhang": { username: "admin", password: initialAdminPassword },
  "emp-lin": { username: "designer", password: initialEmployeePassword },
  "emp-chen": { username: "reviewer", password: initialEmployeePassword },
};
for (const employee of db.data.employees) {
  const legacy = legacyAccounts[employee.id];
  if (!employee.username) {
    employee.username = legacy?.username ?? `user-${employee.id}`;
    migrated = true;
  }
  if (!employee.passwordHash) {
    employee.passwordHash = bcrypt.hashSync(legacy?.password ?? initialEmployeePassword, 10);
    migrated = true;
  }
  if (employee.mustChangePassword === undefined) {
    employee.mustChangePassword = true;
    migrated = true;
  }
}
for (const listing of db.data.listings) {
  const owner = db.data.employees.find((employee) => employee.id === listing.ownerId);
  if (!listing.ownerName) {
    listing.ownerName = owner?.name ?? "历史账号";
    migrated = true;
  }
  if (!listing.createdAt) {
    listing.createdAt = listing.updatedAt;
    migrated = true;
  }
  if (!listing.lastEditedById) {
    listing.lastEditedById = listing.ownerId;
    listing.lastEditedByName = listing.ownerName;
    migrated = true;
  }
}
if (!process.env.AMAZON_REFRESH_TOKEN) {
  for (const listing of db.data.listings) {
    if (listing.status === "可提交") {
      listing.status = "基础通过";
      migrated = true;
    }
  }
}
const dedupedListings = dedupeLocalListingDrafts(db.data.listings);
if (dedupedListings.removed.length) {
  db.data.listings = dedupedListings.listings;
  migrated = true;
}
if (migrated) await db.write();
