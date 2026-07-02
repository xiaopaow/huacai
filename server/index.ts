import dotenv from "dotenv";
import bcrypt from "bcryptjs";
import cors from "cors";
import express from "express";
import { cp, mkdir, readFile, readdir, stat, unlink, writeFile } from "node:fs/promises";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { File } from "node:buffer";
import { join } from "node:path";
import { FormData, ProxyAgent, fetch as openAiFetch } from "undici";
import {
  amazonConfigured,
  amazonConnectorReady,
  amazonMode,
  buildListingsItemPayload,
  getListingsItem,
  putListingsItem,
  validateListing,
} from "./amazon.js";
import { db } from "./db.js";
import type {
  ActivityEvent,
  ActivityType,
  AmazonListing,
  DatabaseSchema,
  Employee,
  GeneratedAsset,
  ImageGenerationJob,
  NotificationRecord,
  WorkspaceProduct,
  WorkspaceTask,
} from "./types.js";

dotenv.config({ path: ".env.local" });
dotenv.config();

type AuthenticatedRequest = express.Request & { employee?: Employee; tokenHash?: string };
type EmployeeRole = Employee["role"];

const app = express();
const port = Number(process.env.API_PORT ?? 8787);
const sessionLifetimeMs = 7 * 24 * 60 * 60 * 1000;
const loginAttemptWindowMs = 15 * 60 * 1000;
const maxLoginAttempts = 5;
const loginAttempts = new Map<string, { count: number; firstAttemptAt: number; blockedUntil: number }>();
const internalWorkerToken = randomBytes(32).toString("hex");
const uploadDirectory = join(process.cwd(), "data", "uploads");
const backupDirectory = join(process.cwd(), "data", "backups");
const outboundProxy = process.env.OUTBOUND_PROXY || process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
const openAiDispatcher = outboundProxy ? new ProxyAgent(outboundProxy) : undefined;
let lastImageApiFailure: { code: string; at: string } | null = null;
await mkdir(uploadDirectory, { recursive: true });
await mkdir(backupDirectory, { recursive: true });

app.use(cors());
app.use(express.json({ limit: "2mb" }));

function publicEmployee(employee: Employee) {
  const { passwordHash: _passwordHash, ...safe } = employee;
  return safe;
}

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function createNotification(
  employeeId: string,
  type: NotificationRecord["type"],
  title: string,
  message: string,
  entityId: string,
) {
  db.data.notifications.unshift({
    id: randomUUID(),
    employeeId,
    type,
    title,
    message,
    entityId,
    createdAt: new Date().toISOString(),
  });
  if (db.data.notifications.length > 5000) db.data.notifications.length = 5000;
}

function loginAttemptKey(request: express.Request, username?: string) {
  return `${request.ip}:${username?.trim().toLowerCase() || "unknown"}`;
}

function getActiveLoginAttempt(key: string) {
  const now = Date.now();
  for (const [attemptKey, attempt] of loginAttempts) {
    if (attempt.blockedUntil <= now && now - attempt.firstAttemptAt >= loginAttemptWindowMs) {
      loginAttempts.delete(attemptKey);
    }
  }
  const attempt = loginAttempts.get(key);
  if (!attempt || now - attempt.firstAttemptAt >= loginAttemptWindowMs) {
    loginAttempts.delete(key);
    return undefined;
  }
  return attempt;
}

function isStrongPassword(password: string) {
  return password.length >= 10 && /[A-Za-z]/.test(password) && /\d/.test(password);
}

async function createDatabaseBackup() {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const name = `huacai-${stamp}.json`;
  const payload = JSON.stringify({
    createdAt: new Date().toISOString(),
    schema: "huacai-workspace-v1",
    data: db.data,
  }, null, 2);
  await writeFile(join(backupDirectory, name), payload, { flag: "wx" });
  await cp(uploadDirectory, join(backupDirectory, name.replace(/\.json$/, "-assets")), {
    recursive: true,
    force: true,
  });
  const info = await stat(join(backupDirectory, name));
  return { name, size: info.size, createdAt: info.birthtime.toISOString(), assetsIncluded: true };
}

async function listDatabaseBackups() {
  const names = (await readdir(backupDirectory)).filter((name) => /^huacai-[\w-]+\.json$/.test(name));
  const backups = await Promise.all(names.map(async (name) => {
    const info = await stat(join(backupDirectory, name));
    let assetsIncluded = false;
    try {
      assetsIncluded = (await stat(join(backupDirectory, name.replace(/\.json$/, "-assets")))).isDirectory();
    } catch {
      assetsIncluded = false;
    }
    return { name, size: info.size, createdAt: info.birthtime.toISOString(), assetsIncluded };
  }));
  return backups.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

async function restoreDatabaseBackup(name: string) {
  if (!/^huacai-[\w-]+\.json$/.test(name)) throw new Error("备份文件名无效");
  const raw = JSON.parse(await readFile(join(backupDirectory, name), "utf8")) as {
    schema?: string;
    data?: Partial<DatabaseSchema>;
  };
  if (raw.schema !== "huacai-workspace-v1" || !raw.data) throw new Error("备份格式无法识别");
  const requiredCollections: Array<keyof DatabaseSchema> = [
    "activities",
    "listings",
    "generatedAssets",
    "uploadedAssets",
    "products",
    "tasks",
    "imageJobs",
  ];
  if (requiredCollections.some((key) => !Array.isArray(raw.data?.[key]))) {
    throw new Error("备份内容不完整，已拒绝恢复");
  }
  const safetyBackup = await createDatabaseBackup();
  db.data.activities = raw.data.activities!;
  db.data.listings = raw.data.listings!;
  db.data.generatedAssets = raw.data.generatedAssets!;
  db.data.uploadedAssets = raw.data.uploadedAssets!;
  db.data.products = raw.data.products!;
  db.data.tasks = raw.data.tasks!;
  db.data.imageJobs = raw.data.imageJobs!;
  db.data.notifications = Array.isArray(raw.data.notifications) ? raw.data.notifications : [];
  for (const job of db.data.imageJobs) {
    if (job.status === "running") {
      job.status = "queued";
      job.progress = 0;
      job.updatedAt = new Date().toISOString();
    }
  }
  const assetSnapshot = join(backupDirectory, name.replace(/\.json$/, "-assets"));
  let assetsRestored = false;
  try {
    if ((await stat(assetSnapshot)).isDirectory()) {
      await cp(assetSnapshot, uploadDirectory, { recursive: true, force: true });
      assetsRestored = true;
    }
  } catch {
    assetsRestored = false;
  }
  await db.write();
  return { ok: true, safetyBackup, assetsRestored };
}

async function ensureDailyBackup() {
  const backups = await listDatabaseBackups();
  const latest = backups[0];
  if (!latest || Date.now() - new Date(latest.createdAt).getTime() > 24 * 60 * 60 * 1000) {
    await createDatabaseBackup();
  }
}

async function authenticate(request: AuthenticatedRequest, response: express.Response, next: express.NextFunction) {
  if (request.header("x-huacai-worker-token") === internalWorkerToken) {
    const employee = db.data.employees.find(
      (item) => item.id === request.header("x-huacai-worker-employee") && item.active,
    );
    if (employee) {
      request.employee = employee;
      next();
      return;
    }
  }
  const authorization = request.header("authorization");
  const token = authorization?.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!token) {
    response.status(401).json({ error: "请先登录" });
    return;
  }
  const tokenHash = hashToken(token);
  const now = new Date();
  const session = db.data.sessions.find((item) => item.tokenHash === tokenHash);
  const employee = session
    ? db.data.employees.find((item) => item.id === session.employeeId && item.active)
    : undefined;
  if (!session || !employee || new Date(session.expiresAt) <= now) {
    if (session) {
      db.data.sessions = db.data.sessions.filter((item) => item.id !== session.id);
      await db.write();
    }
    response.status(401).json({ error: "登录已失效，请重新登录" });
    return;
  }
  request.employee = employee;
  request.tokenHash = tokenHash;
  next();
}

function requireRoles(...roles: EmployeeRole[]) {
  return (request: AuthenticatedRequest, response: express.Response, next: express.NextFunction) => {
    if (!request.employee || !roles.includes(request.employee.role)) {
      response.status(403).json({ error: "当前账号没有访问该功能的权限" });
      return;
    }
    next();
  };
}

app.get("/api/health", (_request, response) => {
  response.json({ ok: true, database: "file", amazonConfigured: amazonConfigured() });
});

app.post("/api/auth/login", async (request, response) => {
  const { username, password } = request.body as { username?: string; password?: string };
  const attemptKey = loginAttemptKey(request, username);
  const activeAttempt = getActiveLoginAttempt(attemptKey);
  if (activeAttempt?.blockedUntil && activeAttempt.blockedUntil > Date.now()) {
    const retryAfter = Math.max(1, Math.ceil((activeAttempt.blockedUntil - Date.now()) / 1000));
    response.set("Retry-After", String(retryAfter));
    response.status(429).json({ error: `登录尝试过多，请 ${Math.ceil(retryAfter / 60)} 分钟后再试` });
    return;
  }
  const employee = db.data.employees.find(
    (item) => item.username.toLowerCase() === username?.trim().toLowerCase() && item.active,
  );
  if (!employee || !password || !(await bcrypt.compare(password, employee.passwordHash))) {
    const now = Date.now();
    const attempt = activeAttempt ?? { count: 0, firstAttemptAt: now, blockedUntil: 0 };
    attempt.count += 1;
    if (attempt.count >= maxLoginAttempts) {
      attempt.blockedUntil = now + loginAttemptWindowMs;
      loginAttempts.set(attemptKey, attempt);
      response.set("Retry-After", String(loginAttemptWindowMs / 1000));
      response.status(429).json({ error: "登录尝试过多，请 15 分钟后再试" });
      return;
    }
    loginAttempts.set(attemptKey, attempt);
    response.status(401).json({ error: `用户名或密码错误，还可尝试 ${maxLoginAttempts - attempt.count} 次` });
    return;
  }
  loginAttempts.delete(attemptKey);
  const token = randomBytes(32).toString("hex");
  const createdAt = new Date();
  db.data.sessions = db.data.sessions.filter((item) => new Date(item.expiresAt) > createdAt);
  const existingSessions = db.data.sessions
    .filter((item) => item.employeeId === employee.id)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const retainedIds = new Set(existingSessions.slice(0, 4).map((item) => item.id));
  db.data.sessions = db.data.sessions.filter(
    (item) => item.employeeId !== employee.id || retainedIds.has(item.id),
  );
  db.data.sessions.push({
    id: randomUUID(),
    tokenHash: hashToken(token),
    employeeId: employee.id,
    createdAt: createdAt.toISOString(),
    expiresAt: new Date(createdAt.getTime() + sessionLifetimeMs).toISOString(),
  });
  await db.write();
  response.json({ token, user: publicEmployee(employee) });
});

app.use("/api", authenticate);

app.post("/api/auth/logout", async (request: AuthenticatedRequest, response) => {
  db.data.sessions = db.data.sessions.filter((item) => item.tokenHash !== request.tokenHash);
  await db.write();
  response.json({ ok: true });
});

app.get("/api/me", (request: AuthenticatedRequest, response) => {
  response.json(publicEmployee(request.employee!));
});

app.post("/api/me/password", async (request: AuthenticatedRequest, response) => {
  const { currentPassword, newPassword } = request.body as {
    currentPassword?: string;
    newPassword?: string;
  };
  const employee = request.employee!;
  if (!currentPassword || !newPassword) {
    response.status(400).json({ error: "请填写当前密码和新密码" });
    return;
  }
  if (!isStrongPassword(newPassword)) {
    response.status(400).json({ error: "新密码至少 10 位，并且同时包含字母和数字" });
    return;
  }
  if (!(await bcrypt.compare(currentPassword, employee.passwordHash))) {
    response.status(400).json({ error: "当前密码不正确" });
    return;
  }
  if (await bcrypt.compare(newPassword, employee.passwordHash)) {
    response.status(400).json({ error: "新密码不能与当前密码相同" });
    return;
  }
  employee.passwordHash = await bcrypt.hash(newPassword, 10);
  employee.mustChangePassword = false;
  db.data.sessions = db.data.sessions.filter(
    (session) => session.employeeId !== employee.id || session.tokenHash === request.tokenHash,
  );
  await db.write();
  response.json({ ok: true, user: publicEmployee(employee) });
});

app.use("/api", (request: AuthenticatedRequest, response, next) => {
  if (request.employee?.mustChangePassword) {
    response.status(403).json({
      code: "PASSWORD_CHANGE_REQUIRED",
      error: "首次登录或密码被重置后，需要先修改密码",
    });
    return;
  }
  next();
});

app.get("/api/team/directory", (_request, response) => {
  response.json(
    db.data.employees
      .filter((employee) => employee.active)
      .map(({ id, name, department, role }) => ({ id, name, department, role })),
  );
});

app.get("/api/notifications", (request: AuthenticatedRequest, response) => {
  const limit = Math.min(100, Math.max(1, Number(request.query.limit ?? 30)));
  response.json(
    db.data.notifications
      .filter((notification) => notification.employeeId === request.employee!.id)
      .slice(0, limit),
  );
});

app.patch("/api/notifications/:id/read", async (request: AuthenticatedRequest, response) => {
  const notification = db.data.notifications.find(
    (item) => item.id === request.params.id && item.employeeId === request.employee!.id,
  );
  if (!notification) {
    response.status(404).json({ error: "通知不存在" });
    return;
  }
  notification.readAt ??= new Date().toISOString();
  await db.write();
  response.json(notification);
});

app.post("/api/notifications/read-all", async (request: AuthenticatedRequest, response) => {
  const readAt = new Date().toISOString();
  for (const notification of db.data.notifications) {
    if (notification.employeeId === request.employee!.id && !notification.readAt) notification.readAt = readAt;
  }
  await db.write();
  response.json({ ok: true });
});

app.get("/api/workspace", (_request, response) => {
  response.json({
    products: db.data.products,
    tasks: db.data.tasks,
  });
});

app.get("/api/workspace/summary", (_request, response) => {
  const start = new Date();
  start.setDate(1);
  start.setHours(0, 0, 0, 0);
  const generatedThisMonth = db.data.generatedAssets.filter(
    (asset) => new Date(asset.createdAt) >= start,
  ).length;
  response.json({
    generatedThisMonth,
    monthlyQuota: Math.max(1, Number(process.env.MONTHLY_IMAGE_QUOTA ?? 500)),
    activeImageJobs: db.data.imageJobs.filter((job) => job.status === "queued" || job.status === "running").length,
    productCount: db.data.products.length,
    taskCount: db.data.tasks.length,
  });
});

app.get("/api/admin/backups", requireRoles("管理员"), async (_request, response) => {
  response.json((await listDatabaseBackups()).slice(0, 30));
});

app.post("/api/admin/backups", requireRoles("管理员"), async (_request, response) => {
  response.status(201).json(await createDatabaseBackup());
});

app.post("/api/admin/backups/:name/restore", requireRoles("管理员"), async (request, response) => {
  try {
    response.json(await restoreDatabaseBackup(String(request.params.name)));
  } catch (error) {
    const missing = error instanceof Error && "code" in error && error.code === "ENOENT";
    response.status(missing ? 404 : 400).json({
      error: missing ? "备份不存在" : error instanceof Error ? error.message : "备份恢复失败",
    });
  }
});

app.post("/api/workspace/bootstrap", requireRoles("管理员"), async (request, response) => {
  if (db.data.products.length || db.data.tasks.length) {
    response.status(409).json({ error: "共享工作区已经初始化" });
    return;
  }
  const input = request.body as { products?: WorkspaceProduct[]; tasks?: WorkspaceTask[] };
  if (!Array.isArray(input.products) || !Array.isArray(input.tasks) || input.products.length > 5000 || input.tasks.length > 20000) {
    response.status(400).json({ error: "初始化工作区数据无效" });
    return;
  }
  db.data.products = input.products;
  db.data.tasks = input.tasks;
  await db.write();
  response.status(201).json({ products: db.data.products, tasks: db.data.tasks });
});

app.post("/api/products", requireRoles("管理员", "运营"), async (request, response) => {
  const product = request.body as WorkspaceProduct;
  if (!product.id || !product.sku?.trim() || !product.name?.trim() || !product.brand?.trim()) {
    response.status(400).json({ error: "SKU、商品名称和品牌为必填项" });
    return;
  }
  if (db.data.products.some((item) => item.id === product.id || item.sku.toLowerCase() === product.sku.toLowerCase())) {
    response.status(409).json({ error: "SKU 已存在" });
    return;
  }
  db.data.products.unshift(product);
  await db.write();
  response.status(201).json(product);
});

app.put("/api/products/:id", requireRoles("管理员", "运营"), async (request, response) => {
  const index = db.data.products.findIndex((item) => item.id === String(request.params.id));
  const product = request.body as WorkspaceProduct;
  if (index < 0) {
    response.status(404).json({ error: "SKU 商品不存在" });
    return;
  }
  if (!product.sku?.trim() || !product.name?.trim() || !product.brand?.trim()) {
    response.status(400).json({ error: "SKU、商品名称和品牌为必填项" });
    return;
  }
  if (db.data.products.some((item, itemIndex) => itemIndex !== index && item.sku.toLowerCase() === product.sku.toLowerCase())) {
    response.status(409).json({ error: "SKU 已存在" });
    return;
  }
  db.data.products[index] = { ...product, id: db.data.products[index].id };
  await db.write();
  response.json(db.data.products[index]);
});

app.delete("/api/products/:id", requireRoles("管理员", "运营"), async (request, response) => {
  const id = String(request.params.id);
  if (db.data.tasks.some((task) => task.productId === id)) {
    response.status(409).json({ error: "该商品已有生产任务，不能直接删除" });
    return;
  }
  const previousLength = db.data.products.length;
  db.data.products = db.data.products.filter((product) => product.id !== id);
  if (db.data.products.length === previousLength) {
    response.status(404).json({ error: "SKU 商品不存在" });
    return;
  }
  await db.write();
  response.json({ ok: true });
});

app.post("/api/tasks", requireRoles("管理员", "运营", "设计"), async (request, response) => {
  const task = request.body as WorkspaceTask;
  if (!task.id || !task.productId || !task.sku || !task.productName || !task.type) {
    response.status(400).json({ error: "任务资料不完整" });
    return;
  }
  if (db.data.tasks.some((item) => item.id === task.id)) {
    response.status(409).json({ error: "任务编号已存在" });
    return;
  }
  const assignee = task.assignedToId
    ? db.data.employees.find((employee) =>
      employee.id === task.assignedToId
      && employee.active
      && (employee.role === "设计" || employee.role === "管理员"),
    )
    : undefined;
  if (task.assignedToId && !assignee) {
    response.status(400).json({ error: "负责人不存在、已停用或不是设计人员" });
    return;
  }
  const creator = (request as AuthenticatedRequest).employee!;
  task.createdById = creator.id;
  task.createdByName = creator.name;
  task.assignedToId = assignee?.id ?? (creator.role === "设计" ? creator.id : undefined);
  task.assignedToName = assignee?.name ?? (creator.role === "设计" ? creator.name : "待分配");
  task.owner = task.assignedToName;
  if (task.dueAt && Number.isNaN(new Date(task.dueAt).getTime())) {
    response.status(400).json({ error: "截止时间格式无效" });
    return;
  }
  db.data.tasks.unshift(task);
  const product = db.data.products.find((item) => item.id === task.productId);
  if (product) {
    product.status = "可生成";
    product.imageCount = Math.max(product.imageCount, task.inputCount ?? 0);
    product.updatedAt = "刚刚";
  }
  if (task.assignedToId && task.assignedToId !== creator.id) {
    createNotification(
      task.assignedToId,
      "TASK_ASSIGNED",
      `新任务：${task.productName}`,
      `${creator.name} 将 ${task.type} 分配给你${task.dueAt ? `，截止 ${new Date(task.dueAt).toLocaleDateString("zh-CN")}` : ""}`,
      task.id,
    );
  }
  await db.write();
  response.status(201).json({ task, product });
});

app.patch("/api/tasks/:id/status", requireRoles("管理员", "运营", "设计", "审核"), async (request, response) => {
  const task = db.data.tasks.find((item) => item.id === String(request.params.id));
  const status = (request.body as { status?: string }).status;
  if (!task) {
    response.status(404).json({ error: "任务不存在" });
    return;
  }
  if (!status || !["草稿", "待生成", "生成中", "待审核", "已驳回", "已通过"].includes(status)) {
    response.status(400).json({ error: "任务状态无效" });
    return;
  }
  task.status = status;
  task.updatedAt = "刚刚";
  await db.write();
  response.json(task);
});

app.patch("/api/tasks/:id/assignment", requireRoles("管理员", "运营"), async (request: AuthenticatedRequest, response) => {
  const task = db.data.tasks.find((item) => item.id === String(request.params.id));
  if (!task) {
    response.status(404).json({ error: "任务不存在" });
    return;
  }
  if (task.status === "已通过") {
    response.status(409).json({ error: "已通过的任务不能改派" });
    return;
  }
  const input = request.body as { assignedToId?: string | null; dueAt?: string | null };
  const assignedToId = input.assignedToId?.trim() || undefined;
  const assignee = assignedToId
    ? db.data.employees.find((employee) =>
      employee.id === assignedToId
      && employee.active
      && (employee.role === "设计" || employee.role === "管理员"),
    )
    : undefined;
  if (assignedToId && !assignee) {
    response.status(400).json({ error: "负责人不存在、已停用或不是设计人员" });
    return;
  }
  const dueAt = input.dueAt?.trim() || undefined;
  if (dueAt && Number.isNaN(new Date(dueAt).getTime())) {
    response.status(400).json({ error: "截止时间格式无效" });
    return;
  }
  const assigneeChanged = task.assignedToId !== assignee?.id;
  const dueDateChanged = task.dueAt !== dueAt;
  task.assignedToId = assignee?.id;
  task.assignedToName = assignee?.name ?? "待分配";
  task.owner = task.assignedToName;
  task.dueAt = dueAt;
  task.updatedAt = "刚刚";
  if (assignee && assignee.id !== request.employee!.id && (assigneeChanged || dueDateChanged)) {
    createNotification(
      assignee.id,
      "TASK_ASSIGNED",
      assigneeChanged ? `任务改派：${task.productName}` : `任务期限更新：${task.productName}`,
      `${request.employee!.name} 更新了任务安排${dueAt ? `，截止 ${new Date(dueAt).toLocaleDateString("zh-CN")}` : "，未设置截止日期"}`,
      task.id,
    );
  }
  await db.write();
  response.json(task);
});

app.post("/api/tasks/:id/submit", requireRoles("管理员", "设计"), async (request: AuthenticatedRequest, response) => {
  const task = db.data.tasks.find((item) => item.id === String(request.params.id));
  const outputAssetIds = [...new Set(
    ((request.body as { outputAssetIds?: string[] }).outputAssetIds ?? []).map(String),
  )].slice(0, 10);
  if (!task) {
    response.status(404).json({ error: "任务不存在" });
    return;
  }
  if (request.employee!.role === "设计" && task.assignedToId && task.assignedToId !== request.employee!.id) {
    response.status(403).json({ error: "该任务分配给了其他设计人员，不能代为提交" });
    return;
  }
  if (!outputAssetIds.length) {
    response.status(400).json({ error: "请至少提交 1 张成品图" });
    return;
  }
  const missingAsset = outputAssetIds.find((id) =>
    !db.data.uploadedAssets.some((asset) => asset.id === id)
    && !db.data.generatedAssets.some((asset) => asset.id === id),
  );
  if (missingAsset) {
    response.status(400).json({ error: "有一张成品图不存在，请重新上传" });
    return;
  }
  if (task.status === "已通过") {
    response.status(409).json({ error: "已通过的任务不能直接覆盖，请新建修改任务" });
    return;
  }
  task.outputAssetIds = outputAssetIds;
  task.outputCount = outputAssetIds.length;
  task.version = (task.version ?? 0) + 1;
  task.status = "待审核";
  task.progress = 100;
  task.owner = request.employee!.name;
  task.submittedAt = new Date().toISOString();
  task.reviewComment = undefined;
  task.reviewedBy = undefined;
  task.reviewedAt = undefined;
  task.updatedAt = "刚刚";
  const product = db.data.products.find((item) => item.id === task.productId);
  if (product) {
    product.status = "生产中";
    product.updatedAt = "刚刚";
  }
  const reviewers = db.data.employees.filter((employee) => employee.active && employee.role === "审核");
  const notificationRecipients = reviewers.length
    ? reviewers
    : db.data.employees.filter((employee) => employee.active && employee.role === "管理员");
  for (const reviewer of notificationRecipients) {
    if (reviewer.id === request.employee!.id) continue;
    createNotification(
      reviewer.id,
      "REVIEW_REQUESTED",
      `待审核：${task.productName}`,
      `${request.employee!.name} 提交了 V${task.version} 成品，共 ${task.outputCount} 张`,
      task.id,
    );
  }
  await db.write();
  response.json(task);
});

app.post("/api/tasks/:id/review", requireRoles("管理员", "审核"), async (request: AuthenticatedRequest, response) => {
  const task = db.data.tasks.find((item) => item.id === String(request.params.id));
  const { approved, comment = "" } = request.body as { approved?: boolean; comment?: string };
  if (!task) {
    response.status(404).json({ error: "任务不存在" });
    return;
  }
  if (task.status !== "待审核") {
    response.status(409).json({ error: "只有待审核任务可以执行审核" });
    return;
  }
  if (typeof approved !== "boolean") {
    response.status(400).json({ error: "审核结果无效" });
    return;
  }
  const normalizedComment = comment.trim().slice(0, 1000);
  if (!approved && !normalizedComment) {
    response.status(400).json({ error: "驳回时必须填写修改意见" });
    return;
  }
  const reviewedAt = new Date().toISOString();
  task.status = approved ? "已通过" : "已驳回";
  task.reviewComment = normalizedComment || "审核通过";
  task.reviewedBy = request.employee!.name;
  task.reviewedAt = reviewedAt;
  task.updatedAt = "刚刚";
  task.reviewHistory = [
    ...(task.reviewHistory ?? []),
    {
      version: task.version ?? 1,
      approved,
      comment: task.reviewComment,
      reviewer: request.employee!.name,
      reviewedAt,
    },
  ];
  const product = db.data.products.find((item) => item.id === task.productId);
  if (product) {
    product.status = approved ? "已交付" : "生产中";
    if (approved) product.imageCount = Math.max(product.imageCount, task.outputCount ?? 0);
    product.updatedAt = "刚刚";
  }
  db.data.activities.push({
    id: randomUUID(),
    employeeId: request.employee!.id,
    type: approved ? "REVIEW_APPROVED" : "REVIEW_REJECTED",
    entityType: "review",
    entityId: task.id,
    quantity: 1,
    metadata: { version: task.version ?? 1 },
    createdAt: reviewedAt,
  });
  const recipients = new Set([task.assignedToId, task.createdById].filter(Boolean) as string[]);
  recipients.delete(request.employee!.id);
  for (const employeeId of recipients) {
    createNotification(
      employeeId,
      approved ? "TASK_APPROVED" : "TASK_REJECTED",
      approved ? `审核通过：${task.productName}` : `需要修改：${task.productName}`,
      approved ? `V${task.version ?? 1} 已通过审核` : task.reviewComment,
      task.id,
    );
  }
  await db.write();
  response.json(task);
});

app.delete("/api/tasks/:id", requireRoles("管理员"), async (request, response) => {
  const id = String(request.params.id);
  const task = db.data.tasks.find((item) => item.id === id);
  if (!task) {
    response.status(404).json({ error: "任务不存在" });
    return;
  }
  const uploadedIds = new Set(
    db.data.uploadedAssets
      .filter((asset) => asset.taskId === id)
      .map((asset) => asset.id),
  );
  for (const assetId of uploadedIds) {
    try {
      await unlink(join(uploadDirectory, assetId));
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
    }
  }
  db.data.uploadedAssets = db.data.uploadedAssets.filter((asset) => !uploadedIds.has(asset.id));
  db.data.notifications = db.data.notifications.filter((notification) => notification.entityId !== id);
  db.data.tasks = db.data.tasks.filter((item) => item.id !== id);
  await db.write();
  response.json({ ok: true });
});

const supportedImageTypes: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

app.post(
  "/api/assets/images",
  express.raw({ type: ["image/jpeg", "image/png", "image/webp"], limit: "20mb" }),
  async (request: AuthenticatedRequest, response) => {
    const extension = supportedImageTypes[request.header("content-type")?.split(";")[0] ?? ""];
    if (!extension) {
      response.status(415).json({ error: "仅支持 JPG、PNG、WEBP 图片" });
      return;
    }
    if (!Buffer.isBuffer(request.body) || request.body.length === 0) {
      response.status(400).json({ error: "没有收到图片内容" });
      return;
    }

    const id = `${randomUUID()}.${extension}`;
    const encodedName = request.header("x-file-name") ?? "image";
    let name = "image";
    try {
      name = decodeURIComponent(encodedName).slice(0, 180);
    } catch {
      name = "image";
    }
    await writeFile(join(uploadDirectory, id), request.body, { flag: "wx" });
    const assetRecord = {
      id,
      ownerId: request.employee!.id,
      name,
      type: request.header("content-type") ?? "application/octet-stream",
      size: request.body.length,
      taskId: request.header("x-task-id") ?? "",
      productId: request.header("x-product-id") ?? "",
      createdAt: new Date().toISOString(),
    };
    db.data.uploadedAssets.push(assetRecord);
    await db.write();
    response.status(201).json({
      id,
      name,
      type: request.header("content-type"),
      size: request.body.length,
      taskId: request.header("x-task-id") ?? "",
      productId: request.header("x-product-id") ?? "",
      url: `/api/assets/images/${id}`,
    });
  },
);

app.get("/api/assets/images/:id", async (request, response) => {
  const id = request.params.id;
  if (!/^[a-f0-9-]+\.(jpg|png|webp)$/.test(id)) {
    response.status(400).json({ error: "图片编号无效" });
    return;
  }
  try {
    const bytes = await readFile(join(uploadDirectory, id));
    const extension = id.split(".").pop();
    response.type(extension === "jpg" ? "image/jpeg" : `image/${extension}`).send(bytes);
  } catch (error) {
    const missing = error instanceof Error && "code" in error && error.code === "ENOENT";
    response.status(missing ? 404 : 500).json({ error: missing ? "图片不存在" : "图片读取失败" });
  }
});

app.delete("/api/assets/images/:id", async (request: AuthenticatedRequest, response) => {
  const id = String(request.params.id);
  if (!/^[a-f0-9-]+\.(jpg|png|webp)$/.test(id)) {
    response.status(400).json({ error: "图片编号无效" });
    return;
  }
  const uploaded = db.data.uploadedAssets.find((asset) => asset.id === id);
  const generated = db.data.generatedAssets.find((asset) => asset.id === id);
  const ownerId = uploaded?.ownerId ?? generated?.ownerId;
  if (!ownerId) {
    response.status(404).json({ error: "素材记录不存在" });
    return;
  }
  if (ownerId !== request.employee!.id && request.employee!.role !== "管理员") {
    response.status(403).json({ error: "只能删除自己创建的素材" });
    return;
  }
  try {
    await unlink(join(uploadDirectory, id));
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
  }
  db.data.uploadedAssets = db.data.uploadedAssets.filter((asset) => asset.id !== id);
  db.data.generatedAssets = db.data.generatedAssets.filter((asset) => asset.id !== id);
  await db.write();
  response.json({ ok: true });
});

type ImageRatio = "1:1" | "16:9" | "3:4";
type ImageQuality = "low" | "medium" | "high";

const imageSizes: Record<ImageRatio, string> = {
  "1:1": "1024x1024",
  "16:9": "1536x1024",
  "3:4": "1024x1536",
};

app.get("/api/ai/status", (_request, response) => {
  response.json({
    configured: Boolean(process.env.OPENAI_API_KEY),
    model: process.env.OPENAI_IMAGE_MODEL || "gpt-image-2",
    proxyConfigured: Boolean(openAiDispatcher),
    lastFailure: lastImageApiFailure,
  });
});

app.get("/api/ai/images", (request: AuthenticatedRequest, response) => {
  const limit = Math.min(50, Math.max(1, Number(request.query.limit ?? 24)));
  const assets = [...db.data.generatedAssets]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, limit)
    .map((asset) => ({
      ...asset,
      url: `/api/assets/images/${asset.id}`,
      ownerName: db.data.employees.find((employee) => employee.id === asset.ownerId)?.name ?? "团队成员",
    }));
  response.json(assets);
});

app.post("/api/ai/images/generate", async (request: AuthenticatedRequest, response) => {
  const input = request.body as {
    prompt?: string;
    ratio?: ImageRatio;
    quality?: ImageQuality;
    referenceAssetIds?: string[];
    templateId?: string;
    templateTitle?: string;
  };
  const prompt = input.prompt?.trim() ?? "";
  const ratio = input.ratio ?? "1:1";
  const quality = input.quality ?? "medium";
  const referenceAssetIds = [...new Set(input.referenceAssetIds ?? [])].slice(0, 4);
  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_IMAGE_MODEL || "gpt-image-2";

  if (!apiKey) {
    response.status(503).json({ error: "AI 生图服务尚未配置，请管理员检查 .env.local" });
    return;
  }
  if (!prompt || prompt.length > 4000) {
    response.status(400).json({ error: "请输入 1–4000 字的图片提示词" });
    return;
  }
  if (!(ratio in imageSizes) || !["low", "medium", "high"].includes(quality)) {
    response.status(400).json({ error: "图片比例或质量参数无效" });
    return;
  }
  if (referenceAssetIds.some((id) => !/^[a-f0-9-]+\.(jpg|png|webp)$/.test(id))) {
    response.status(400).json({ error: "参考图编号无效" });
    return;
  }

  try {
    let upstream: Awaited<ReturnType<typeof openAiFetch>>;
    if (referenceAssetIds.length) {
      const form = new FormData();
      form.append("model", model);
      form.append("prompt", prompt);
      form.append("size", imageSizes[ratio]);
      form.append("quality", quality);
      for (const id of referenceAssetIds) {
        const extension = id.split(".").pop()!;
        const mime = extension === "jpg" ? "image/jpeg" : `image/${extension}`;
        const bytes = await readFile(join(uploadDirectory, id));
        form.append("image[]", new File([new Uint8Array(bytes)], id, { type: mime }));
      }
      upstream = await openAiFetch("https://api.openai.com/v1/images/edits", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}` },
        body: form,
        dispatcher: openAiDispatcher,
      });
    } else {
      upstream = await openAiFetch("https://api.openai.com/v1/images/generations", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          prompt,
          size: imageSizes[ratio],
          quality,
        }),
        dispatcher: openAiDispatcher,
      });
    }

    const upstreamBody = await upstream.json() as {
      data?: Array<{ b64_json?: string }>;
      error?: { code?: string; message?: string };
    };
    if (!upstream.ok) {
      const code = upstreamBody.error?.code;
      lastImageApiFailure = {
        code: code || `http_${upstream.status}`,
        at: new Date().toISOString(),
      };
      const friendly = code === "moderation_blocked"
        ? "提示词或参考图未通过内容安全检查，请调整后重试"
        : code === "billing_hard_limit_reached"
          ? "OpenAI 项目生成额度已用完，请管理员补充余额或提高项目硬额度"
        : upstream.status === 429
          ? "AI 服务当前繁忙或额度不足，请稍后重试并检查项目额度"
          : upstream.status === 401 || upstream.status === 403
            ? "AI 服务授权失败，请管理员检查 API 密钥与模型权限"
            : "图片生成失败，请稍后重试";
      response.status(upstream.status >= 500 ? 502 : 400).json({
        error: friendly,
        code: code || `http_${upstream.status}`,
      });
      return;
    }

    const base64 = upstreamBody.data?.[0]?.b64_json;
    if (!base64) {
      response.status(502).json({ error: "AI 服务没有返回图片，请重新生成", code: "empty_result" });
      return;
    }

    const bytes = Buffer.from(base64, "base64");
    lastImageApiFailure = null;
    const id = `${randomUUID()}.png`;
    await writeFile(join(uploadDirectory, id), bytes, { flag: "wx" });
    const createdAt = new Date().toISOString();
    const asset: GeneratedAsset = {
      id,
      ownerId: request.employee!.id,
      prompt,
      ratio,
      quality,
      model,
      size: imageSizes[ratio],
      templateId: input.templateId,
      templateTitle: input.templateTitle,
      referenceCount: referenceAssetIds.length,
      createdAt,
    };
    const event: ActivityEvent = {
      id: randomUUID(),
      employeeId: request.employee!.id,
      type: "IMAGE_GENERATED",
      entityType: "asset",
      entityId: id,
      quantity: 1,
      metadata: {
        model,
        ratio,
        quality,
        templateId: input.templateId,
        templateTitle: input.templateTitle,
        referenceCount: referenceAssetIds.length,
      },
      createdAt,
    };
    db.data.generatedAssets.push(asset);
    db.data.activities.push(event);
    await db.write();

    response.status(201).json({
      id,
      url: `/api/assets/images/${id}`,
      dataUrl: `data:image/png;base64,${base64}`,
      model,
      size: imageSizes[ratio],
      quality,
      prompt,
      ratio,
      templateTitle: input.templateTitle,
      ownerId: request.employee!.id,
      ownerName: request.employee!.name,
      createdAt,
    });
  } catch (error) {
    const missingReference = error instanceof Error && "code" in error && error.code === "ENOENT";
    response.status(missingReference ? 404 : 502).json({
      error: missingReference ? "有一张参考图已不存在，请重新上传" : "暂时无法连接 AI 生图服务，请稍后重试",
    });
  }
});

const activeImageJobs = new Set<string>();

function automaticRetryDelay(code: string | undefined, attempts: number) {
  if (!code || attempts >= 3) return 0;
  const retryable = code === "worker_unavailable"
    || code === "empty_result"
    || code === "rate_limit_exceeded"
    || code === "server_error"
    || code === "http_429"
    || /^http_5\d\d$/.test(code);
  if (!retryable) return 0;
  return attempts <= 1 ? 3000 : 8000;
}

function queueAutomaticImageRetry(job: ImageGenerationJob, code: string | undefined, message: string) {
  const delay = automaticRetryDelay(code, job.attempts);
  if (!delay) return false;
  const retryAt = new Date(Date.now() + delay);
  job.status = "queued";
  job.progress = 5;
  job.errorCode = code;
  job.errorMessage = `${message}，系统将在 ${Math.ceil(delay / 1000)} 秒后自动重试`;
  job.completedAt = undefined;
  job.nextRetryAt = retryAt.toISOString();
  job.updatedAt = new Date().toISOString();
  enqueueImageJob(job.id, delay);
  return true;
}

function publicImageJob(job: ImageGenerationJob) {
  const asset = job.resultAssetId
    ? db.data.generatedAssets.find((item) => item.id === job.resultAssetId)
    : undefined;
  return {
    ...job,
    ownerName: db.data.employees.find((employee) => employee.id === job.ownerId)?.name ?? "团队成员",
    result: asset ? {
      ...asset,
      url: `/api/assets/images/${asset.id}`,
      ownerName: db.data.employees.find((employee) => employee.id === asset.ownerId)?.name ?? "团队成员",
    } : undefined,
  };
}

async function cleanupJobReferences(job: ImageGenerationJob) {
  for (const id of job.referenceAssetIds) {
    const uploaded = db.data.uploadedAssets.find((asset) => asset.id === id && asset.ownerId === job.ownerId);
    if (!uploaded) continue;
    try {
      await unlink(join(uploadDirectory, id));
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
    }
    db.data.uploadedAssets = db.data.uploadedAssets.filter((asset) => asset.id !== id);
  }
}

async function runImageJob(jobId: string) {
  if (activeImageJobs.has(jobId)) return;
  const job = db.data.imageJobs.find((item) => item.id === jobId);
  if (!job || job.status !== "queued") return;
  activeImageJobs.add(jobId);
  const startedAt = new Date().toISOString();
  job.status = "running";
  job.progress = 35;
  job.attempts += 1;
  job.startedAt = startedAt;
  job.updatedAt = startedAt;
  job.errorCode = undefined;
  job.errorMessage = undefined;
  job.nextRetryAt = undefined;
  await db.write();

  try {
    const upstream = await fetch(`http://127.0.0.1:${port}/api/ai/images/generate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Huacai-Worker-Token": internalWorkerToken,
        "X-Huacai-Worker-Employee": job.ownerId,
      },
      body: JSON.stringify({
        prompt: job.prompt,
        ratio: job.ratio,
        quality: job.quality,
        referenceAssetIds: job.referenceAssetIds,
        templateId: job.templateId,
        templateTitle: job.templateTitle,
      }),
    });
    const body = await upstream.json() as { id?: string; error?: string; code?: string };
    const completedAt = new Date().toISOString();
    if (!upstream.ok || !body.id) {
      const code = body.code ?? `http_${upstream.status}`;
      const message = body.error ?? "图片生成失败，请稍后重试";
      if (!queueAutomaticImageRetry(job, code, message)) {
        job.status = "failed";
        job.progress = 100;
        job.errorCode = code;
        job.errorMessage = message;
        job.completedAt = completedAt;
        job.updatedAt = completedAt;
      }
    } else {
      job.status = "succeeded";
      job.progress = 100;
      job.resultAssetId = body.id;
      job.completedAt = completedAt;
      job.updatedAt = completedAt;
      await cleanupJobReferences(job);
    }
    await db.write();
  } catch {
    const completedAt = new Date().toISOString();
    const message = "后台生成服务暂时不可用";
    if (!queueAutomaticImageRetry(job, "worker_unavailable", message)) {
      job.status = "failed";
      job.progress = 100;
      job.errorCode = "worker_unavailable";
      job.errorMessage = `${message}，请稍后重试`;
      job.completedAt = completedAt;
      job.updatedAt = completedAt;
    }
    await db.write();
  } finally {
    activeImageJobs.delete(jobId);
  }
}

function enqueueImageJob(jobId: string, delay = 20) {
  setTimeout(() => void runImageJob(jobId), delay);
}

app.post("/api/ai/jobs", async (request: AuthenticatedRequest, response) => {
  const input = request.body as {
    prompt?: string;
    ratio?: ImageRatio;
    quality?: ImageQuality;
    referenceAssetIds?: string[];
    templateId?: string;
    templateTitle?: string;
  };
  const prompt = input.prompt?.trim() ?? "";
  const ratio = input.ratio ?? "1:1";
  const quality = input.quality ?? "medium";
  const referenceAssetIds = [...new Set(input.referenceAssetIds ?? [])].slice(0, 4);
  if (!prompt || prompt.length > 4000) {
    response.status(400).json({ error: "请输入 1–4000 字的图片提示词" });
    return;
  }
  if (!(ratio in imageSizes) || !["low", "medium", "high"].includes(quality)) {
    response.status(400).json({ error: "图片比例或质量参数无效" });
    return;
  }
  const invalidReference = referenceAssetIds.some((id) => {
    const asset = db.data.uploadedAssets.find((item) => item.id === id);
    return !asset || asset.ownerId !== request.employee!.id;
  });
  if (invalidReference) {
    response.status(400).json({ error: "参考图不存在或不属于当前账号" });
    return;
  }
  const now = new Date().toISOString();
  const job: ImageGenerationJob = {
    id: randomUUID(),
    ownerId: request.employee!.id,
    status: "queued",
    progress: 5,
    prompt,
    ratio,
    quality,
    referenceAssetIds,
    templateId: input.templateId,
    templateTitle: input.templateTitle,
    attempts: 0,
    createdAt: now,
    updatedAt: now,
  };
  db.data.imageJobs.push(job);
  await db.write();
  enqueueImageJob(job.id);
  response.status(202).json(publicImageJob(job));
});

app.get("/api/ai/jobs", (request: AuthenticatedRequest, response) => {
  const limit = Math.min(50, Math.max(1, Number(request.query.limit ?? 20)));
  const jobs = db.data.imageJobs
    .filter((job) => job.ownerId === request.employee!.id || request.employee!.role === "管理员")
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, limit)
    .map(publicImageJob);
  response.json(jobs);
});

app.get("/api/ai/jobs/:id", (request: AuthenticatedRequest, response) => {
  const job = db.data.imageJobs.find((item) => item.id === String(request.params.id));
  if (!job) {
    response.status(404).json({ error: "生成任务不存在" });
    return;
  }
  if (job.ownerId !== request.employee!.id && request.employee!.role !== "管理员") {
    response.status(403).json({ error: "没有权限查看该生成任务" });
    return;
  }
  response.json(publicImageJob(job));
});

app.post("/api/ai/jobs/:id/retry", async (request: AuthenticatedRequest, response) => {
  const job = db.data.imageJobs.find((item) => item.id === String(request.params.id));
  if (!job) {
    response.status(404).json({ error: "生成任务不存在" });
    return;
  }
  if (job.ownerId !== request.employee!.id && request.employee!.role !== "管理员") {
    response.status(403).json({ error: "没有权限重试该任务" });
    return;
  }
  if (job.status !== "failed") {
    response.status(409).json({ error: "只有失败任务可以重试" });
    return;
  }
  if (job.attempts >= 3) {
    response.status(409).json({ error: "该任务已重试多次，请调整提示词或参考图后新建任务" });
    return;
  }
  job.status = "queued";
  job.progress = 5;
  job.errorCode = undefined;
  job.errorMessage = undefined;
  job.completedAt = undefined;
  job.nextRetryAt = undefined;
  job.updatedAt = new Date().toISOString();
  await db.write();
  enqueueImageJob(job.id);
  response.status(202).json(publicImageJob(job));
});

app.delete("/api/ai/jobs/:id", async (request: AuthenticatedRequest, response) => {
  const job = db.data.imageJobs.find((item) => item.id === String(request.params.id));
  if (!job) {
    response.status(404).json({ error: "生成任务不存在" });
    return;
  }
  if (job.ownerId !== request.employee!.id && request.employee!.role !== "管理员") {
    response.status(403).json({ error: "没有权限移除该任务记录" });
    return;
  }
  if (job.status === "queued" || job.status === "running") {
    response.status(409).json({ error: "任务执行期间不能移除" });
    return;
  }
  await cleanupJobReferences(job);
  db.data.imageJobs = db.data.imageJobs.filter((item) => item.id !== job.id);
  await db.write();
  response.json({ ok: true });
});

app.get("/api/employees", requireRoles("管理员"), (_request, response) => {
  response.json(db.data.employees.map(publicEmployee));
});

app.post("/api/employees", requireRoles("管理员"), async (request, response) => {
  const input = request.body as Partial<Employee> & { password?: string };
  if (!input.username?.trim() || !input.name?.trim() || !input.password || !input.department || !input.role) {
    response.status(400).json({ error: "用户名、姓名、初始密码、部门和角色为必填项" });
    return;
  }
  if (db.data.employees.some((item) => item.username.toLowerCase() === input.username!.trim().toLowerCase())) {
    response.status(409).json({ error: "用户名已经存在" });
    return;
  }
  if (!isStrongPassword(input.password)) {
    response.status(400).json({ error: "初始密码至少 10 位，并且同时包含字母和数字" });
    return;
  }
  const employee: Employee = {
    id: randomUUID(),
    username: input.username.trim(),
    passwordHash: await bcrypt.hash(input.password, 10),
    name: input.name.trim(),
    department: input.department,
    role: input.role,
    active: true,
    mustChangePassword: true,
  };
  db.data.employees.push(employee);
  await db.write();
  response.status(201).json(publicEmployee(employee));
});

app.patch("/api/employees/:id", requireRoles("管理员"), async (request, response) => {
  const employee = db.data.employees.find((item) => item.id === request.params.id);
  if (!employee) {
    response.status(404).json({ error: "员工不存在" });
    return;
  }
  const input = request.body as Partial<Pick<Employee, "name" | "department" | "role" | "active">>;
  if (input.name !== undefined) employee.name = input.name;
  if (input.department !== undefined) employee.department = input.department;
  if (input.role !== undefined) employee.role = input.role;
  if (input.active !== undefined) employee.active = input.active;
  if (!employee.active) {
    db.data.sessions = db.data.sessions.filter((item) => item.employeeId !== employee.id);
  }
  await db.write();
  response.json(publicEmployee(employee));
});

app.post("/api/employees/:id/reset-password", requireRoles("管理员"), async (request, response) => {
  const employee = db.data.employees.find((item) => item.id === request.params.id);
  const password = (request.body as { password?: string }).password;
  if (!employee) {
    response.status(404).json({ error: "员工不存在" });
    return;
  }
  if (!password || !isStrongPassword(password)) {
    response.status(400).json({ error: "新密码至少 10 位，并且同时包含字母和数字" });
    return;
  }
  employee.passwordHash = await bcrypt.hash(password, 10);
  employee.mustChangePassword = true;
  db.data.sessions = db.data.sessions.filter((item) => item.employeeId !== employee.id);
  await db.write();
  response.json({ ok: true });
});

app.post("/api/activity", async (request: AuthenticatedRequest, response) => {
  const { type, entityType, entityId, quantity = 1, metadata } = request.body as Partial<ActivityEvent>;
  if (!type || !entityType || !entityId) {
    response.status(400).json({ error: "type、entityType、entityId 为必填项" });
    return;
  }
  const event: ActivityEvent = {
    id: randomUUID(),
    employeeId: request.employee!.id,
    type: type as ActivityType,
    entityType,
    entityId,
    quantity: Math.max(1, Number(quantity)),
    metadata,
    createdAt: new Date().toISOString(),
  };
  db.data.activities.push(event);
  await db.write();
  response.status(201).json(event);
});

app.get("/api/activity", requireRoles("管理员"), (request, response) => {
  const limit = Math.min(200, Number(request.query.limit ?? 50));
  response.json([...db.data.activities].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit));
});

app.get("/api/analytics/employees", requireRoles("管理员"), (request, response) => {
  const days = Math.max(1, Math.min(365, Number(request.query.days ?? 30)));
  const after = Date.now() - days * 86400000;
  const events = db.data.activities.filter((event) => new Date(event.createdAt).getTime() >= after);
  const metrics = db.data.employees.map((employee) => {
    const own = events.filter((event) => event.employeeId === employee.id);
    const count = (type: ActivityType) => own.filter((event) => event.type === type).reduce((sum, event) => sum + event.quantity, 0);
    return {
      ...publicEmployee(employee),
      skuCreated: count("SKU_CREATED"),
      imagesUploaded: count("IMAGE_UPLOADED"),
      tasksCreated: count("TASK_CREATED"),
      reviewsCompleted: count("REVIEW_APPROVED") + count("REVIEW_REJECTED"),
      listingsDrafted: count("LISTING_DRAFTED"),
      listingsPublished: count("LISTING_PUBLISHED"),
      lastActiveAt: own.sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]?.createdAt ?? null,
    };
  });
  response.json({ days, metrics, events: events.length });
});

app.get("/api/listings", requireRoles("管理员", "运营"), (_request, response) => {
  response.json([...db.data.listings].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
});

app.post("/api/listings", requireRoles("管理员", "运营"), async (request: AuthenticatedRequest, response) => {
  const input = request.body as Partial<AmazonListing>;
  const listing: AmazonListing = {
    id: randomUUID(),
    sku: input.sku ?? "",
    marketplaceId: input.marketplaceId ?? "ATVPDKIKX0DER",
    marketplaceName: input.marketplaceName ?? "美国站",
    productType: input.productType ?? "",
    title: input.title ?? "",
    brand: input.brand ?? "",
    description: input.description ?? "",
    bulletPoints: input.bulletPoints ?? ["", "", "", "", ""],
    searchTerms: input.searchTerms ?? "",
    price: Number(input.price ?? 0),
    currency: input.currency ?? "USD",
    quantity: Number(input.quantity ?? 0),
    status: "草稿",
    ownerId: request.employee!.id,
    issues: [],
    updatedAt: new Date().toISOString(),
  };
  listing.issues = validateListing(listing);
  listing.status = listing.issues.length ? "待完善" : amazonConfigured() ? "可提交" : "基础通过";
  db.data.listings.unshift(listing);
  db.data.activities.push({
    id: randomUUID(),
    employeeId: request.employee!.id,
    type: "LISTING_DRAFTED",
    entityType: "listing",
    entityId: listing.id,
    quantity: 1,
    createdAt: new Date().toISOString(),
  });
  await db.write();
  response.status(201).json(listing);
});

app.put("/api/listings/:id", requireRoles("管理员", "运营"), async (request, response) => {
  const listing = db.data.listings.find((item) => item.id === request.params.id);
  if (!listing) {
    response.status(404).json({ error: "Listing 不存在" });
    return;
  }
  Object.assign(listing, request.body, { id: listing.id, ownerId: listing.ownerId, updatedAt: new Date().toISOString() });
  listing.issues = validateListing(listing);
  listing.status = listing.issues.length ? "待完善" : amazonConfigured() ? "可提交" : "基础通过";
  await db.write();
  response.json(listing);
});

app.post("/api/listings/:id/validate", requireRoles("管理员", "运营"), async (request: AuthenticatedRequest, response) => {
  const listing = db.data.listings.find((item) => item.id === request.params.id);
  if (!listing) {
    response.status(404).json({ error: "Listing 不存在" });
    return;
  }
  listing.issues = validateListing(listing);
  listing.status = listing.issues.length ? "待完善" : amazonConfigured() ? "可提交" : "基础通过";
  db.data.activities.push({
    id: randomUUID(),
    employeeId: request.employee!.id,
    type: "LISTING_VALIDATED",
    entityType: "listing",
    entityId: listing.id,
    quantity: 1,
    createdAt: new Date().toISOString(),
  });
  await db.write();
  response.json({
    listing,
    payloadPreview: buildListingsItemPayload(listing),
    amazonSchemaValidation: amazonConfigured() ? "ready" : "credentials_required",
  });
});

app.post("/api/listings/:id/submit", requireRoles("管理员", "运营"), async (request: AuthenticatedRequest, response) => {
  const listing = db.data.listings.find((item) => item.id === request.params.id);
  if (!listing) {
    response.status(404).json({ error: "Listing 不存在" });
    return;
  }
  if (!amazonConfigured()) {
    response.status(409).json({
      code: "AMAZON_NOT_CONFIGURED",
      error: "需要配置 Amazon SP-API 应用、卖家授权和 Product Listing 角色后才能提交",
    });
    return;
  }
  if (!amazonConnectorReady()) {
    response.status(409).json({
      code: "AMAZON_PRODUCTION_NOT_CONFIRMED",
      error: "Amazon 正式发布尚未确认启用，请管理员检查运行模式和生产确认配置",
    });
    return;
  }
  listing.issues = validateListing(listing);
  if (listing.issues.length) {
    listing.status = "待完善";
    listing.updatedAt = new Date().toISOString();
    await db.write();
    response.status(400).json({ error: `Listing 还有 ${listing.issues.length} 个待完善项`, issues: listing.issues });
    return;
  }
  try {
    const preview = await putListingsItem(listing, true);
    const previewErrors = (preview.issues ?? [])
      .filter((issue) => issue.severity === "ERROR")
      .map((issue) => `${issue.code ? `${issue.code}: ` : ""}${issue.message ?? "Amazon 返回未知校验问题"}`);
    if (previewErrors.length) {
      listing.status = "失败";
      listing.issues = previewErrors;
      listing.updatedAt = new Date().toISOString();
      await db.write();
      response.status(422).json({
        code: "AMAZON_VALIDATION_FAILED",
        error: `Amazon 官方校验发现 ${previewErrors.length} 个问题`,
        issues: previewErrors,
      });
      return;
    }
    const result = await putListingsItem(listing);
    const amazonIssues = (result.issues ?? [])
      .filter((issue) => issue.severity === "ERROR" || issue.severity === "WARNING")
      .map((issue) => `${issue.code ? `${issue.code}: ` : ""}${issue.message ?? "Amazon 返回未知问题"}`);
    listing.amazonSubmissionId = result.submissionId;
    listing.issues = amazonIssues;
    listing.status = result.status === "ACCEPTED" ? "提交中" : amazonIssues.length ? "失败" : "提交中";
    listing.updatedAt = new Date().toISOString();
    await db.write();
    response.json({ listing, amazon: result });
  } catch (error) {
    listing.status = "失败";
    listing.issues = [error instanceof Error ? error.message : "Amazon 提交失败"];
    listing.updatedAt = new Date().toISOString();
    await db.write();
    response.status(502).json({ error: listing.issues[0] });
  }
});

app.post("/api/listings/:id/refresh-status", requireRoles("管理员", "运营"), async (request, response) => {
  const listing = db.data.listings.find((item) => item.id === request.params.id);
  if (!listing) {
    response.status(404).json({ error: "Listing 不存在" });
    return;
  }
  if (!amazonConnectorReady()) {
    response.status(409).json({ error: "Amazon SP-API 尚未授权或未确认启用" });
    return;
  }
  try {
    const result = await getListingsItem(listing);
    const hasAmazonError = (result.issues ?? []).some((issue) => issue.severity === "ERROR");
    const issues = (result.issues ?? [])
      .filter((issue) => issue.severity === "ERROR" || issue.severity === "WARNING")
      .map((issue) => `${issue.code ? `${issue.code}: ` : ""}${issue.message ?? "Amazon 返回未知问题"}`);
    const amazonStatuses = (result.summaries ?? []).flatMap((summary) => summary.status ?? []);
    listing.issues = issues;
    listing.status = hasAmazonError
      ? "失败"
      : amazonStatuses.some((status) => status === "BUYABLE" || status === "DISCOVERABLE")
        ? "已发布"
        : "提交中";
    listing.updatedAt = new Date().toISOString();
    await db.write();
    response.json({ listing, amazon: result });
  } catch (error) {
    response.status(502).json({ error: error instanceof Error ? error.message : "Amazon 状态查询失败" });
  }
});

app.get("/api/amazon/status", requireRoles("管理员", "运营"), (_request, response) => {
  response.json({
    configured: amazonConfigured(),
    connectorReady: amazonConnectorReady(),
    required: ["AMAZON_SELLER_ID", "AMAZON_LWA_CLIENT_ID", "AMAZON_LWA_CLIENT_SECRET", "AMAZON_REFRESH_TOKEN"],
    mode: amazonMode(),
  });
});

const webDirectory = join(process.cwd(), "dist");
app.use(express.static(webDirectory));
app.use(async (request, response, next) => {
  if (request.method !== "GET" || request.path.startsWith("/api/")) {
    next();
    return;
  }
  try {
    response.type("html").send(await readFile(join(webDirectory, "index.html"), "utf8"));
  } catch {
    next();
  }
});

const host = process.env.API_HOST ?? (process.env.NODE_ENV === "production" ? "0.0.0.0" : "127.0.0.1");
app.listen(port, host, () => {
  console.log(`Huacai listening on http://${host}:${port}`);
  db.data.imageJobs.filter((job) => job.status === "queued").forEach((job) => {
    const delay = job.nextRetryAt
      ? Math.max(20, new Date(job.nextRetryAt).getTime() - Date.now())
      : 20;
    enqueueImageJob(job.id, delay);
  });
  void ensureDailyBackup().catch((error) => console.error("Huacai daily backup failed", error));
  if (!process.env.INITIAL_ADMIN_PASSWORD) {
    console.warn("首次登录管理员账号：admin / ChangeMe123!（请在部署前修改）");
  }
});
