import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { JSONFilePreset } from "lowdb/node";
import bcrypt from "bcryptjs";
import type { DatabaseSchema } from "./types.js";

const dataDirectory = join(process.cwd(), "data");
await mkdir(dataDirectory, { recursive: true });
const initialAdminPassword = process.env.INITIAL_ADMIN_PASSWORD ?? "ChangeMe123!";
const initialEmployeePassword = process.env.INITIAL_EMPLOYEE_PASSWORD ?? "Employee123!";

const defaultData: DatabaseSchema = {
  employees: [
    { id: "emp-zhang", username: "admin", passwordHash: bcrypt.hashSync(initialAdminPassword, 10), name: "张宁", department: "Amazon 运营", role: "管理员", active: true, mustChangePassword: true },
    { id: "emp-lin", username: "designer", passwordHash: bcrypt.hashSync(initialEmployeePassword, 10), name: "林晓", department: "视觉设计", role: "设计", active: true, mustChangePassword: true },
    { id: "emp-chen", username: "reviewer", passwordHash: bcrypt.hashSync(initialEmployeePassword, 10), name: "陈璐", department: "商品审核", role: "审核", active: true, mustChangePassword: true },
  ],
  sessions: [],
  activities: [
    { id: "act-seed-1", employeeId: "emp-zhang", type: "SKU_CREATED", entityType: "product", entityId: "prd-001", quantity: 4, createdAt: new Date(Date.now() - 86400000).toISOString() },
    { id: "act-seed-2", employeeId: "emp-zhang", type: "TASK_CREATED", entityType: "task", entityId: "TSK-018", quantity: 6, createdAt: new Date(Date.now() - 7200000).toISOString() },
    { id: "act-seed-3", employeeId: "emp-lin", type: "IMAGE_UPLOADED", entityType: "asset", entityId: "asset-batch-1", quantity: 18, createdAt: new Date(Date.now() - 10800000).toISOString() },
    { id: "act-seed-4", employeeId: "emp-chen", type: "REVIEW_APPROVED", entityType: "review", entityId: "review-1", quantity: 5, createdAt: new Date(Date.now() - 5400000).toISOString() },
  ],
  listings: [
    {
      id: "lst-001",
      sku: "HC-HDP-001",
      marketplaceId: "ATVPDKIKX0DER",
      marketplaceName: "美国站",
      productType: "HEADPHONES",
      title: "FLORA Wireless Over-Ear Headphones with Active Noise Cancellation",
      brand: "FLORA",
      description: "Comfortable wireless headphones designed for work, travel and everyday listening.",
      bulletPoints: [
        "Active noise cancellation for focused listening",
        "Comfortable over-ear cushions for extended wear",
        "Stable wireless connection and clear calls",
        "Foldable design for travel and storage",
        "Long-lasting battery for everyday use"
      ],
      searchTerms: "wireless headphones noise cancelling over ear travel",
      price: 59.99,
      currency: "USD",
      quantity: 100,
      status: "待完善",
      ownerId: "emp-zhang",
      issues: ["缺少外部商品编码及 Amazon 类目必填属性"],
      updatedAt: new Date().toISOString(),
    },
  ],
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
for (const job of db.data.imageJobs) {
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
if (!process.env.AMAZON_REFRESH_TOKEN) {
  for (const listing of db.data.listings) {
    if (listing.status === "可提交") {
      listing.status = "基础通过";
      migrated = true;
    }
  }
}
if (migrated) await db.write();
