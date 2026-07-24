import dotenv from "dotenv";
import bcrypt from "bcryptjs";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import sharp from "sharp";
import { cp, mkdir, readFile, readdir, rm, stat, unlink, writeFile } from "node:fs/promises";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { File } from "node:buffer";
import { join, resolve, sep } from "node:path";
import { FormData, ProxyAgent, fetch as openAiFetch } from "undici";
import {
  amazonConfigured,
  amazonConnectorReady,
  amazonMode,
  buildListingsItemPayload,
  getAmazonProductTypeDefinition,
  getListingsItem,
  putListingsItem,
  searchAmazonProductTypes,
  summarizeAmazonProductType,
  validateListing,
} from "./amazon.js";
import { db } from "./db.js";
import { backupsToPrune, normalizedBackupRetention } from "./backupRules.js";
import { directActivityWriteDisabledResponse } from "./activityRules.js";
import {
  canViewGeneratedAsset,
  canViewUploadedAsset,
  publicAssetOwnerName,
} from "./assetVisibility.js";
import { publicAiStatusForEmployee } from "./aiStatusRules.js";
import { assetDeletionBlockReason } from "./assetDeleteRules.js";
import { validateAssetUploadContext, type AssetPurpose } from "./assetUploadRules.js";
import { validateProductImport } from "./productImport.js";
import { canDeleteLocalListing, findListingConflict } from "./listingRules.js";
import {
  buildListingGenerationMessages,
  extractCompetitorSnapshot,
  extractEtsyApiSnapshot,
  extractEtsyCompetitorSnapshot,
  normalizeGeneratedListingCopy,
  parseCompetitorProductUrl,
  parseListingModelJson,
  validateGeneratedListingCopy,
  type CompetitorReference,
  type CompetitorSnapshot,
} from "./listingGeneration.js";
import { getDemoDataStatus, removeDemoData } from "./demoData.js";
import { isValidUsername, validateEmployeeUpdate, type EmployeeUpdateInput } from "./employeeRules.js";
import { publicTeamDirectoryEntry, visibleTeamDirectory } from "./teamDirectoryRules.js";
import { normalizeProductInput, productDeletionBlockReason } from "./productRules.js";
import {
  isTaskType,
  reviewRejectionCommentError,
  taskCreationInputError,
  taskOutputAssetIntegrityError,
  taskOutputSubmissionError,
  taskReviewApprovalError,
  taskSubmissionError,
} from "./taskRules.js";
import { visibleProductsForEmployee, visibleTasksForEmployee } from "./taskVisibility.js";
import { canAccessImageJob, canCreateImageGenerationJob, hasInvalidOwnedReferenceAsset } from "./imageJobRules.js";
import { publicHealthResponse } from "./publicHealth.js";
import {
  canDeleteListingGeneration,
  canRestoreListingGeneration,
  visibleListingGenerationsForEmployee,
} from "./listingHistoryRules.js";
import { publicListingForEmployee } from "./listingVisibility.js";
import { buildSystemHealthReport } from "./systemHealth.js";
import { buildImagePromptPlan } from "./imagePromptPlan.js";
import { corsOriginAllowed, parseCorsOrigins, parseTrustProxy } from "./securityConfig.js";
import type {
  ActivityEvent,
  ActivityType,
  AmazonListing,
  DatabaseSchema,
  Employee,
  GeneratedAsset,
  ImageGenerationJob,
  ListingGenerationRecord,
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
const production = process.env.NODE_ENV === "production";
const corsOrigins = parseCorsOrigins(process.env.CORS_ORIGINS);
const sessionLifetimeMs = 7 * 24 * 60 * 60 * 1000;
const loginAttemptWindowMs = 15 * 60 * 1000;
const maxLoginAttempts = 5;
const loginAttempts = new Map<string, { count: number; firstAttemptAt: number; blockedUntil: number }>();
const internalWorkerToken = randomBytes(32).toString("hex");
const databaseFile = join(process.cwd(), "data", "huacai-db.json");
const uploadDirectory = join(process.cwd(), "data", "uploads");
const thumbnailDirectory = join(process.cwd(), "data", "thumbnails");
const backupDirectory = join(process.cwd(), "data", "backups");
const backupRetention = normalizedBackupRetention(process.env.BACKUP_RETENTION_COUNT);
const outboundProxy = process.env.OUTBOUND_PROXY || process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
const openAiDispatcher = outboundProxy ? new ProxyAgent(outboundProxy) : undefined;
let lastImageApiFailure: { code: string; at: string } | null = null;
await mkdir(uploadDirectory, { recursive: true });
await mkdir(thumbnailDirectory, { recursive: true });
await mkdir(backupDirectory, { recursive: true });

app.disable("x-powered-by");
app.set("trust proxy", parseTrustProxy(process.env.TRUST_PROXY));
app.use(helmet({
  contentSecurityPolicy: production ? {
    directives: {
      defaultSrc: ["'self'"],
      baseUri: ["'self'"],
      connectSrc: ["'self'"],
      fontSrc: ["'self'", "data:"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
      imgSrc: ["'self'", "data:", "blob:", "https://cos.huotu333.cn"],
      objectSrc: ["'none'"],
      scriptSrc: ["'self'"],
      scriptSrcAttr: ["'none'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      upgradeInsecureRequests: null,
    },
  } : false,
  crossOriginEmbedderPolicy: false,
  referrerPolicy: { policy: "no-referrer" },
}));
app.use((_request, response, next) => {
  response.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()");
  next();
});
if (!production) {
  app.use(cors());
} else if (corsOrigins.length) {
  app.use(cors({
    origin(origin, callback) {
      callback(null, corsOriginAllowed(origin, corsOrigins));
    },
  }));
}
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
  options: Pick<NotificationRecord, "targetPage" | "metadata"> = {},
) {
  db.data.notifications.unshift({
    id: randomUUID(),
    employeeId,
    type,
    title,
    message,
    entityId,
    entityType: "task",
    targetPage: options.targetPage ?? (type === "REVIEW_REQUESTED" ? "reviews" : "tasks"),
    metadata: options.metadata,
    createdAt: new Date().toISOString(),
  });
  if (db.data.notifications.length > 5000) db.data.notifications.length = 5000;
}

function taskNotificationMetadata(task: WorkspaceTask, action: NonNullable<NotificationRecord["metadata"]>["action"]) {
  return {
    sku: task.sku,
    productName: task.productName,
    taskType: task.type,
    version: task.version,
    dueAt: task.dueAt,
    action,
  };
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
  return { name, size: info.size, createdAt: info.mtime.toISOString(), assetsIncluded: true };
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
    return { name, size: info.size, createdAt: info.mtime.toISOString(), assetsIncluded };
  }));
  return backups.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function backupPath(name: string) {
  if (!/^huacai-[\w-]+(?:\.json|-assets)$/.test(name)) throw new Error("备份文件名无效");
  const root = resolve(backupDirectory);
  const target = resolve(root, name);
  if (!target.startsWith(`${root}${sep}`)) throw new Error("备份路径越界");
  return target;
}

async function pruneDatabaseBackups() {
  const backups = await listDatabaseBackups();
  const expired = backupsToPrune(backups, backupRetention);
  for (const backup of expired) {
    await rm(backupPath(backup.name), { force: true });
    await rm(backupPath(backup.name.replace(/\.json$/, "-assets")), { recursive: true, force: true });
  }
  return { retained: backups.length - expired.length, removed: expired.length };
}

async function restoreDatabaseBackup(name: string) {
  if (!/^huacai-[\w-]+\.json$/.test(name)) throw new Error("备份文件名无效");
  const raw = JSON.parse(await readFile(backupPath(name), "utf8")) as {
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
  db.data.listingGenerations = Array.isArray(raw.data.listingGenerations) ? raw.data.listingGenerations : [];
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
  const assetSnapshot = backupPath(name.replace(/\.json$/, "-assets"));
  let assetsRestored = false;
  try {
    if ((await stat(assetSnapshot)).isDirectory()) {
      const uploadRoot = resolve(uploadDirectory);
      const dataRoot = resolve(process.cwd(), "data");
      if (!uploadRoot.startsWith(`${dataRoot}${sep}`)) throw new Error("上传目录路径越界");
      await rm(uploadRoot, { recursive: true, force: true });
      await mkdir(uploadRoot, { recursive: true });
      await cp(assetSnapshot, uploadDirectory, { recursive: true, force: true });
      await rm(thumbnailDirectory, { recursive: true, force: true });
      await mkdir(thumbnailDirectory, { recursive: true });
      assetsRestored = true;
    }
  } catch {
    assetsRestored = false;
  }
  await db.write();
  await pruneDatabaseBackups();
  return { ok: true, safetyBackup, assetsRestored };
}

async function ensureDailyBackup() {
  const backups = await listDatabaseBackups();
  const latest = backups[0];
  if (!latest || Date.now() - new Date(latest.createdAt).getTime() > 24 * 60 * 60 * 1000) {
    await createDatabaseBackup();
  }
  await pruneDatabaseBackups();
}

async function pathReady(path: string, expected: "file" | "directory") {
  try {
    const info = await stat(path);
    return expected === "file" ? info.isFile() : info.isDirectory();
  } catch {
    return false;
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
  response.json(publicHealthResponse());
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

app.get("/api/team/directory", (request: AuthenticatedRequest, response) => {
  response.json(
    visibleTeamDirectory(db.data.employees, request.employee!)
      .map(publicTeamDirectoryEntry),
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

app.get("/api/workspace", (request: AuthenticatedRequest, response) => {
  const tasks = visibleTasksForEmployee(db.data.tasks, request.employee!);
  const products = visibleProductsForEmployee(db.data.products, tasks, request.employee!);
  response.json({
    products,
    tasks,
  });
});

app.get("/api/workspace/summary", (request: AuthenticatedRequest, response) => {
  const start = new Date();
  start.setDate(1);
  start.setHours(0, 0, 0, 0);
  const employee = request.employee!;
  const tasks = visibleTasksForEmployee(db.data.tasks, employee);
  const products = visibleProductsForEmployee(db.data.products, tasks, employee);
  const imageGenerationEvents = db.data.activities.filter((event) => (
    event.type === "IMAGE_GENERATED"
    && (employee.role === "管理员" || event.employeeId === employee.id)
  ));
  const imageJobs = employee.role === "管理员"
    ? db.data.imageJobs
    : db.data.imageJobs.filter((job) => job.ownerId === employee.id);
  const listingGenerations = employee.role === "管理员"
    ? db.data.listingGenerations
    : db.data.listingGenerations.filter((item) => item.generatedById === employee.id);
  response.json({
    generatedThisMonth: imageGenerationEvents
      .filter((event) => new Date(event.createdAt) >= start)
      .reduce((sum, event) => sum + event.quantity, 0),
    listingsGeneratedThisMonth: listingGenerations.filter((item) => new Date(item.generatedAt) >= start).length,
    statisticsScope: employee.role === "管理员" ? "team" : "personal",
    monthlyQuota: Math.max(1, Number(process.env.MONTHLY_IMAGE_QUOTA ?? 500)),
    activeImageJobs: imageJobs.filter((job) => job.status === "queued" || job.status === "running").length,
    productCount: products.length,
    taskCount: tasks.length,
  });
});

app.get("/api/admin/health", requireRoles("管理员"), async (_request, response) => {
  const backups = await listDatabaseBackups();
  response.json(buildSystemHealthReport({
    data: db.data,
    demoData: getDemoDataStatus(db.data),
    databaseFileReady: await pathReady(databaseFile, "file"),
    uploadDirectoryReady: await pathReady(uploadDirectory, "directory"),
    backupDirectoryReady: await pathReady(backupDirectory, "directory"),
    backupCount: backups.length,
    latestBackupAt: backups[0]?.createdAt,
    backupRetention,
    openAiConfigured: Boolean(process.env.OPENAI_API_KEY),
    openAiLastFailure: lastImageApiFailure,
    amazonConfigured: amazonConfigured(),
    amazonConnectorReady: amazonConnectorReady(),
    amazonMode: amazonMode(),
    initialAdminPasswordConfigured: Boolean(process.env.INITIAL_ADMIN_PASSWORD),
    initialAdminPasswordUsesDefault: process.env.INITIAL_ADMIN_PASSWORD === "ChangeMe123!",
    initialEmployeePasswordUsesDefault: process.env.INITIAL_EMPLOYEE_PASSWORD === "Employee123!",
    apiPort: port,
    nodeVersion: process.version,
  }));
});

app.get("/api/admin/backups", requireRoles("管理员"), async (_request, response) => {
  response.json((await listDatabaseBackups()).slice(0, 30));
});

app.post("/api/admin/backups", requireRoles("管理员"), async (_request, response) => {
  const backup = await createDatabaseBackup();
  const retention = await pruneDatabaseBackups();
  response.status(201).json({ ...backup, retention });
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

app.get("/api/admin/demo-data", requireRoles("管理员"), (_request, response) => {
  response.json(getDemoDataStatus(db.data));
});

app.delete("/api/admin/demo-data", requireRoles("管理员"), async (_request, response) => {
  const status = getDemoDataStatus(db.data);
  if (!status.detected) {
    response.status(404).json({ error: "未检测到可清理的演示数据" });
    return;
  }
  const safetyBackup = await createDatabaseBackup();
  const removed = removeDemoData(db.data);
  await db.write();
  await pruneDatabaseBackups();
  response.json({ ok: true, removed, safetyBackup });
});

app.post("/api/products", requireRoles("管理员", "运营"), async (request: AuthenticatedRequest, response) => {
  const result = normalizeProductInput(request.body as WorkspaceProduct, `prd-${randomUUID()}`);
  if (result.error || !result.product) {
    response.status(400).json({ error: result.error ?? "商品资料无效" });
    return;
  }
  const product = result.product;
  if (db.data.products.some((item) => item.sku.toLowerCase() === product.sku.toLowerCase())) {
    response.status(409).json({ error: "SKU 已存在" });
    return;
  }
  db.data.products.unshift(product);
  db.data.activities.push({
    id: randomUUID(),
    employeeId: request.employee!.id,
    type: "SKU_CREATED",
    entityType: "product",
    entityId: product.id,
    quantity: 1,
    createdAt: new Date().toISOString(),
  });
  await db.write();
  response.status(201).json(product);
});

app.post("/api/products/import", requireRoles("管理员", "运营"), async (request: AuthenticatedRequest, response) => {
  const input = request.body as { products?: WorkspaceProduct[] };
  if (!Array.isArray(input.products) || !input.products.length) {
    response.status(400).json({ error: "没有可导入的 SKU 商品" });
    return;
  }
  if (input.products.length > 500) {
    response.status(400).json({ error: "单次最多导入 500 个 SKU" });
    return;
  }

  const { products, errors } = validateProductImport(input.products, db.data.products);

  if (errors.length) {
    response.status(409).json({ error: `导入校验失败：${errors.slice(0, 5).join("；")}${errors.length > 5 ? `；另有 ${errors.length - 5} 个问题` : ""}` });
    return;
  }

  db.data.products.unshift(...products);
  db.data.activities.unshift({
    id: randomUUID(),
    employeeId: request.employee!.id,
    type: "SKU_CREATED",
    entityType: "product",
    entityId: `bulk-${randomUUID()}`,
    quantity: products.length,
    metadata: { source: "spreadsheet-import" },
    createdAt: new Date().toISOString(),
  });
  await db.write();
  response.status(201).json({ products, importedCount: products.length });
});

app.put("/api/products/:id", requireRoles("管理员", "运营"), async (request, response) => {
  const index = db.data.products.findIndex((item) => item.id === String(request.params.id));
  if (index < 0) {
    response.status(404).json({ error: "SKU 商品不存在" });
    return;
  }
  const result = normalizeProductInput(request.body as WorkspaceProduct, db.data.products[index].id);
  if (result.error || !result.product) {
    response.status(400).json({ error: result.error ?? "商品资料无效" });
    return;
  }
  const product = result.product;
  if (db.data.products.some((item, itemIndex) => itemIndex !== index && item.sku.toLowerCase() === product.sku.toLowerCase())) {
    response.status(409).json({ error: "SKU 已存在" });
    return;
  }
  db.data.products[index] = product;
  await db.write();
  response.json(db.data.products[index]);
});

app.delete("/api/products/:id", requireRoles("管理员", "运营"), async (request, response) => {
  const id = String(request.params.id);
  const product = db.data.products.find((item) => item.id === id);
  if (!product) {
    response.status(404).json({ error: "SKU 商品不存在" });
    return;
  }
  const blockedReason = productDeletionBlockReason(product, db.data.tasks, db.data.listings);
  if (blockedReason) {
    response.status(409).json({ error: blockedReason });
    return;
  }
  db.data.products = db.data.products.filter((item) => item.id !== id);
  await db.write();
  response.json({ ok: true });
});

app.post("/api/tasks", requireRoles("管理员", "运营", "设计"), async (request: AuthenticatedRequest, response) => {
  const input = request.body as Partial<WorkspaceTask>;
  const id = input.id?.trim() ?? "";
  const productId = input.productId?.trim() ?? "";
  if (!/^[A-Za-z0-9-]{6,64}$/.test(id) || !productId || !isTaskType(input.type)) {
    response.status(400).json({ error: "任务资料不完整" });
    return;
  }
  if (db.data.tasks.some((item) => item.id === id)) {
    response.status(409).json({ error: "任务编号已存在" });
    return;
  }
  const product = db.data.products.find((item) => item.id === productId);
  if (!product) {
    response.status(404).json({ error: "关联的 SKU 商品不存在，请刷新商品库后重试" });
    return;
  }
  const creator = request.employee!;
  const requestedAssigneeId = creator.role === "设计" ? creator.id : input.assignedToId?.trim();
  const assignee = requestedAssigneeId
    ? db.data.employees.find((employee) =>
      employee.id === requestedAssigneeId
      && employee.active
      && (employee.role === "设计" || employee.role === "管理员"),
    )
    : undefined;
  if (requestedAssigneeId && !assignee) {
    response.status(400).json({ error: "负责人不存在、已停用或不是设计人员" });
    return;
  }
  const dueAt = input.dueAt?.trim() || undefined;
  if (dueAt && Number.isNaN(new Date(dueAt).getTime())) {
    response.status(400).json({ error: "截止时间格式无效" });
    return;
  }
  const inputAssetIds = [...new Set((input.inputAssetIds ?? []).map(String))].slice(0, 10);
  const inputAssetError = taskCreationInputError(input.type, inputAssetIds.length);
  if (inputAssetError) {
    response.status(400).json({ error: inputAssetError });
    return;
  }
  const invalidInputAsset = inputAssetIds.find((assetId) => {
    const asset = db.data.uploadedAssets.find((item) => item.id === assetId);
    return !asset
      || asset.ownerId !== creator.id
      || asset.taskId !== id
      || asset.productId !== product.id
      || asset.purpose !== "input";
  });
  if (invalidInputAsset) {
    response.status(400).json({ error: "商品原图与当前任务不匹配，请重新上传" });
    return;
  }
  const task: WorkspaceTask = {
    id,
    productId: product.id,
    sku: product.sku,
    productName: product.name,
    type: input.type,
    status: "待生成",
    progress: 0,
    owner: assignee?.name ?? "待分配",
    createdById: creator.id,
    createdByName: creator.name,
    assignedToId: assignee?.id,
    assignedToName: assignee?.name ?? "待分配",
    dueAt,
    updatedAt: "刚刚",
    inputAssetIds,
    inputCount: inputAssetIds.length,
    templateId: input.templateId?.trim().slice(0, 100) || undefined,
    templateTitle: input.templateTitle?.trim().slice(0, 200) || undefined,
    templatePrompt: input.templatePrompt?.trim().slice(0, 4000) || undefined,
  };
  db.data.tasks.unshift(task);
  product.status = "可生成";
  product.imageCount = Math.max(product.imageCount, task.inputCount ?? 0);
  product.updatedAt = "刚刚";
  db.data.activities.push({
    id: randomUUID(),
    employeeId: creator.id,
    type: "TASK_CREATED",
    entityType: "task",
    entityId: task.id,
    quantity: 1,
    createdAt: new Date().toISOString(),
  });
  db.data.activities.push({
    id: randomUUID(),
    employeeId: creator.id,
    type: "IMAGE_UPLOADED",
    entityType: "asset",
    entityId: task.id,
    quantity: inputAssetIds.length,
    createdAt: new Date().toISOString(),
  });
  if (task.assignedToId && task.assignedToId !== creator.id) {
    createNotification(
      task.assignedToId,
      "TASK_ASSIGNED",
      `新任务：${task.productName}`,
      `${creator.name} 将 ${task.type} 分配给你${task.dueAt ? `，截止 ${new Date(task.dueAt).toLocaleDateString("zh-CN")}` : ""}`,
      task.id,
      { targetPage: "tasks", metadata: taskNotificationMetadata(task, "open_task") },
    );
  }
  await db.write();
  response.status(201).json({ task, product });
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
      { targetPage: "tasks", metadata: taskNotificationMetadata(task, "open_task") },
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
  const submissionError = taskSubmissionError(task, request.employee!);
  if (submissionError) {
    response.status(task.status === "待审核" || task.status === "已通过" ? 409 : 403).json({ error: submissionError });
    return;
  }
  const outputError = taskOutputSubmissionError(task, outputAssetIds.length);
  if (outputError) {
    response.status(400).json({ error: outputError });
    return;
  }
  const invalidAsset = outputAssetIds.find((id) => {
    const uploaded = db.data.uploadedAssets.find((asset) => asset.id === id);
    if (uploaded) {
      return uploaded.taskId !== task.id
        || uploaded.productId !== task.productId
        || uploaded.purpose !== "output"
        || (request.employee!.role === "设计" && uploaded.ownerId !== request.employee!.id);
    }
    const generated = db.data.generatedAssets.find((asset) => asset.id === id);
    return !generated || (request.employee!.role === "设计" && generated.ownerId !== request.employee!.id);
  });
  if (invalidAsset) {
    response.status(400).json({ error: "有一张成品图不属于当前任务或当前提交人，请重新选择" });
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
      { targetPage: "reviews", metadata: taskNotificationMetadata(task, "review_task") },
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
  if (!approved) {
    const rejectionError = reviewRejectionCommentError(normalizedComment);
    if (rejectionError) {
      response.status(400).json({ error: rejectionError });
      return;
    }
  }
  if (approved) {
    const approvalError = taskReviewApprovalError(task);
    if (approvalError) {
      response.status(400).json({ error: approvalError });
      return;
    }
    const assetIntegrityError = taskOutputAssetIntegrityError(task, db.data.uploadedAssets, db.data.generatedAssets);
    if (assetIntegrityError) {
      response.status(400).json({ error: `不能通过审核：${assetIntegrityError}` });
      return;
    }
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
      approved ? `V${task.version ?? 1} 已通过审核，可进入素材复用或 Listing 制作` : `V${task.version ?? 1} 已驳回：${task.reviewComment}`,
      task.id,
      {
        targetPage: "tasks",
        metadata: taskNotificationMetadata(task, approved ? "view_result" : "revise_task"),
      },
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
    const purpose = request.header("x-asset-purpose");
    if (!extension) {
      response.status(415).json({ error: "仅支持 JPG、PNG、WEBP 图片" });
      return;
    }
    if (!purpose || !["input", "output", "reference"].includes(purpose)) {
      response.status(400).json({ error: "图片用途无效，请刷新页面后重新上传" });
      return;
    }
    if (!Buffer.isBuffer(request.body) || request.body.length === 0) {
      response.status(400).json({ error: "没有收到图片内容" });
      return;
    }
    const taskId = request.header("x-task-id") ?? "";
    const productId = request.header("x-product-id") ?? "";
    const uploadContext = validateAssetUploadContext({
      purpose: purpose as AssetPurpose,
      taskId,
      productId,
      employee: request.employee!,
      products: db.data.products,
      tasks: db.data.tasks,
    });
    if (uploadContext.error) {
      response.status(uploadContext.status).json({ error: uploadContext.error });
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
      taskId,
      productId,
      purpose: purpose as "input" | "output" | "reference",
      createdAt: new Date().toISOString(),
    };
    db.data.uploadedAssets.push(assetRecord);
    await db.write();
    response.status(201).json({
      id,
      name,
      type: request.header("content-type"),
      size: request.body.length,
      taskId,
      productId,
      purpose,
      url: `/api/assets/images/${id}`,
    });
  },
);

app.get("/api/assets/images/:id", async (request: AuthenticatedRequest, response) => {
  const id = String(request.params.id);
  if (!/^[a-f0-9-]+\.(jpg|png|webp)$/.test(id)) {
    response.status(400).json({ error: "图片编号无效" });
    return;
  }
  const uploaded = db.data.uploadedAssets.find((asset) => asset.id === id);
  const generated = db.data.generatedAssets.find((asset) => asset.id === id);
  if (!uploaded && !generated) {
    response.status(404).json({ error: "素材记录不存在" });
    return;
  }
  const allowed = uploaded
    ? canViewUploadedAsset(uploaded, db.data.tasks, request.employee!)
    : generated
      ? canViewGeneratedAsset(generated, db.data.tasks, request.employee!)
      : false;
  if (!allowed) {
    response.status(403).json({ error: "没有权限查看该素材" });
    return;
  }
  try {
    const bytes = await readFile(join(uploadDirectory, id));
    const extension = id.split(".").pop();
    response
      .set("Cache-Control", "private, max-age=31536000, immutable")
      .set("Vary", "Authorization")
      .type(extension === "jpg" ? "image/jpeg" : `image/${extension}`)
      .send(bytes);
  } catch (error) {
    const missing = error instanceof Error && "code" in error && error.code === "ENOENT";
    response.status(missing ? 404 : 500).json({ error: missing ? "图片不存在" : "图片读取失败" });
  }
});

app.get("/api/assets/images/:id/thumbnail", async (request: AuthenticatedRequest, response) => {
  const id = String(request.params.id);
  if (!/^[a-f0-9-]+\.(jpg|png|webp)$/.test(id)) {
    response.status(400).json({ error: "图片编号无效" });
    return;
  }
  const uploaded = db.data.uploadedAssets.find((asset) => asset.id === id);
  const generated = db.data.generatedAssets.find((asset) => asset.id === id);
  if (!uploaded && !generated) {
    response.status(404).json({ error: "素材记录不存在" });
    return;
  }
  const allowed = uploaded
    ? canViewUploadedAsset(uploaded, db.data.tasks, request.employee!)
    : generated
      ? canViewGeneratedAsset(generated, db.data.tasks, request.employee!)
      : false;
  if (!allowed) {
    response.status(403).json({ error: "没有权限查看该素材" });
    return;
  }

  const thumbnailPath = join(thumbnailDirectory, `${id}.webp`);
  try {
    let bytes: Buffer;
    try {
      bytes = await readFile(thumbnailPath);
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
      bytes = await sharp(join(uploadDirectory, id))
        .rotate()
        .resize({ width: 480, height: 480, fit: "inside", withoutEnlargement: true })
        .webp({ quality: 76, effort: 4 })
        .toBuffer();
      try {
        await writeFile(thumbnailPath, bytes, { flag: "wx" });
      } catch (writeError) {
        if (!(writeError instanceof Error && "code" in writeError && writeError.code === "EEXIST")) throw writeError;
      }
    }
    response
      .set("Cache-Control", "private, max-age=31536000, immutable")
      .set("Vary", "Authorization")
      .type("image/webp")
      .send(bytes);
  } catch (error) {
    const missing = error instanceof Error && "code" in error && error.code === "ENOENT";
    response.status(missing ? 404 : 500).json({ error: missing ? "图片不存在" : "缩略图生成失败" });
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
  const blockedReason = assetDeletionBlockReason(id, db.data.tasks, db.data.imageJobs);
  if (blockedReason) {
    response.status(409).json({ error: blockedReason });
    return;
  }
  try {
    await unlink(join(uploadDirectory, id));
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
  }
  try {
    await unlink(join(thumbnailDirectory, `${id}.webp`));
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
type ImageCount = 1 | 2 | 3 | 4 | 5 | 6 | 7;

const imageSizes: Record<ImageRatio, string> = {
  "1:1": "1024x1024",
  "16:9": "1536x1024",
  "3:4": "1024x1536",
};
const imageDeliverySizes: Record<ImageRatio, string> = {
  "1:1": "1600x1600",
  "16:9": "1536x1024",
  "3:4": "1024x1536",
};
const imageCountOptions: ImageCount[] = [1, 2, 3, 4, 5, 6, 7];

const defaultOpenRouterImageApiUrl = "https://openrouter.ai/api/v1/images";
const openAiImageGenerationApiUrl = "https://api.openai.com/v1/images/generations";
const openAiImageEditApiUrl = "https://api.openai.com/v1/images/edits";
const defaultOpenRouterTextApiUrl = "https://openrouter.ai/api/v1/chat/completions";

function configuredImageApiUrl() {
  return process.env.OPENAI_IMAGE_API_URL?.trim()
    || process.env.OPENROUTER_IMAGE_API_URL?.trim()
    || defaultOpenRouterImageApiUrl;
}

function configuredImageModel(apiUrl = configuredImageApiUrl()) {
  return process.env.OPENAI_IMAGE_MODEL?.trim()
    || (apiUrl.includes("openrouter.ai") ? "openai/gpt-image-2" : "gpt-image-2");
}

function configuredTextApiUrl() {
  return process.env.OPENAI_TEXT_API_URL?.trim()
    || process.env.OPENROUTER_TEXT_API_URL?.trim()
    || defaultOpenRouterTextApiUrl;
}

function configuredTextModel(apiUrl = configuredTextApiUrl()) {
  return process.env.OPENAI_TEXT_MODEL?.trim()
    || process.env.OPENROUTER_TEXT_MODEL?.trim()
    || (apiUrl.includes("openrouter.ai") ? "openai/gpt-5.4" : "gpt-5.4");
}

function imageRequestHeaders(apiKey: string, json = true) {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
  };
  if (json) headers["Content-Type"] = "application/json";

  const siteUrl = process.env.OPENROUTER_SITE_URL?.trim();
  if (siteUrl) headers["HTTP-Referer"] = siteUrl;

  const appName = process.env.OPENROUTER_APP_NAME?.trim() || "Huacai Amazon Studio";
  if (appName) headers["X-Title"] = appName;

  return headers;
}

function competitorRequestHeaders(reference: CompetitorReference) {
  return {
    // Etsy exposes a small public Open Graph document to link-preview crawlers even
    // when the full browser page is protected by its human-verification layer.
    "User-Agent": reference.source === "etsy"
      ? "Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)"
      : "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36",
    Accept: "text/html,application/xhtml+xml",
    "Accept-Language": reference.marketplace === "日本站" ? "ja-JP,ja;q=0.9,en;q=0.7" : reference.marketplace === "德国站" ? "de-DE,de;q=0.9,en;q=0.7" : "en-US,en;q=0.9",
  };
}

async function fetchCompetitorSnapshot(reference: CompetitorReference) {
  const etsyApiKey = process.env.ETSY_API_KEY?.trim();
  if (reference.source === "etsy" && etsyApiKey) {
    try {
      const apiUrl = `https://openapi.etsy.com/v3/application/listings/${reference.externalId}?includes=Shop`;
      const upstream = await openAiFetch(apiUrl, {
        method: "GET",
        headers: { Accept: "application/json", "x-api-key": etsyApiKey },
        dispatcher: openAiDispatcher,
        signal: AbortSignal.timeout(20_000),
      });
      const body = await upstream.json().catch(() => ({})) as unknown;
      if (!upstream.ok) {
        const error = upstream.status === 401 || upstream.status === 403
          ? "Etsy API 授权失败，请管理员检查 ETSY_API_KEY"
          : upstream.status === 404
            ? "该 Etsy Listing 不存在、已下架或不是公开商品"
            : `Etsy API 暂时不可用（HTTP ${upstream.status}），请稍后重试`;
        return { snapshot: undefined, status: "unavailable" as const, error };
      }
      const snapshot = extractEtsyApiSnapshot(body);
      if (!snapshot.title && !snapshot.description) {
        return { snapshot: undefined, status: "blocked" as const, error: "Etsy API 未返回可用的商品标题或描述" };
      }
      return { snapshot, status: "fetched" as const };
    } catch (error) {
      const timedOut = error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError");
      return {
        snapshot: undefined,
        status: "unavailable" as const,
        error: timedOut ? "Etsy API 读取超时，请稍后重试" : "暂时无法连接 Etsy API，请检查网络或代理配置",
      };
    }
  }

  try {
    const upstream = await openAiFetch(reference.canonicalUrl, {
      method: "GET",
      headers: competitorRequestHeaders(reference),
      redirect: "follow",
      dispatcher: openAiDispatcher,
      signal: AbortSignal.timeout(20_000),
    });
    const finalReference = parseCompetitorProductUrl(upstream.url);
    if (finalReference.source !== reference.source || finalReference.externalId !== reference.externalId) {
      return { snapshot: undefined, status: "unavailable" as const };
    }
    const contentType = upstream.headers.get("content-type") ?? "";
    if (!upstream.ok || !contentType.includes("text/html")) {
      return {
        snapshot: undefined,
        status: "unavailable" as const,
        error: reference.source === "etsy"
          ? `Etsy 公共商品页暂时无法读取（HTTP ${upstream.status}），请稍后重试或更换链接`
          : `Amazon 商品页读取失败（HTTP ${upstream.status}），请稍后重试`,
      };
    }
    const html = (await upstream.text()).slice(0, 3_000_000);
    const snapshot = reference.source === "etsy"
      ? extractEtsyCompetitorSnapshot(html)
      : extractCompetitorSnapshot(html);
    if (!snapshot.title && !snapshot.bulletPoints.length && !snapshot.description) {
      return {
        snapshot: undefined,
        status: "blocked" as const,
        error: reference.source === "etsy"
          ? "Etsy 返回了人机验证页，公共抓取暂时受限，请稍后重试或更换链接"
          : "Amazon 返回了人机验证页，请稍后重试",
      };
    }
    return { snapshot, status: "fetched" as const };
  } catch (error) {
    const timedOut = error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError");
    return {
      snapshot: undefined,
      status: "unavailable" as const,
      error: timedOut ? `${reference.sourceLabel} 商品页读取超时，请稍后重试` : `暂时无法连接 ${reference.sourceLabel}，请检查网络或代理配置`,
    };
  }
}

function textProviderFriendlyMessage(status: number) {
  if (status === 401 || status === 403) return "AI 文案服务授权失败，请管理员检查中转 API 密钥与文本模型权限";
  if (status === 402) return "AI 文案额度不足，请管理员检查 OpenRouter 余额或项目限额";
  if (status === 429) return "AI 文案服务当前繁忙或额度不足，请稍后重试";
  return "AI 文案生成失败，请稍后重试";
}

function chatMessageText(content: unknown) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((item) => item && typeof item === "object" && "text" in item ? String((item as { text?: unknown }).text ?? "") : "")
    .join("");
}

async function referenceImageDataUrls(referenceAssetIds: string[]) {
  return Promise.all(referenceAssetIds.map(async (id) => {
    const extension = id.split(".").pop()!;
    const mime = extension === "jpg" ? "image/jpeg" : `image/${extension}`;
    const bytes = await readFile(join(uploadDirectory, id));
    return `data:${mime};base64,${Buffer.from(bytes).toString("base64")}`;
  }));
}

function imageProviderPrompt(prompt: string, referenceCount: number) {
  if (!referenceCount) return prompt;
  return [
    "请把参考图中的主体商品/画作作为唯一主体，尽量保持主体的外观、颜色、构图、纹理、图案和比例，不要替换成其他商品或其他画面。",
    "可以根据用户要求更换场景、光线、背景和拍摄角度，但主体必须明显来自参考图。",
    prompt,
  ].join("\n");
}

function normalizeImageCount(value: unknown, fallback: ImageCount): ImageCount | null {
  if (value === undefined || value === null || value === "") return fallback;
  const count = Number(value);
  return imageCountOptions.includes(count as ImageCount) ? count as ImageCount : null;
}

class ImageProviderError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

function imageProviderFriendlyMessage(code: string, status: number) {
  if (code === "moderation_blocked") return "提示词或参考图未通过内容安全检查，请调整后重试";
  if (code === "billing_hard_limit_reached") return "AI 生图额度不足，请管理员检查 OpenRouter 余额、模型权限或项目限额";
  if (status === 429) return "AI 服务当前繁忙或额度不足，请稍后重试并检查中转额度";
  if (status === 401 || status === 403) return "AI 服务授权失败，请管理员检查中转 API 密钥与模型权限";
  return "图片生成失败，请稍后重试";
}

async function collectImageBase64FromResponse(items: Array<{ b64_json?: string; url?: string }> | undefined) {
  const images: string[] = [];
  for (const item of items ?? []) {
    if (item.b64_json) {
      images.push(item.b64_json);
      continue;
    }
    if (!item.url) continue;
    const imageResponse = await openAiFetch(item.url, { dispatcher: openAiDispatcher });
    if (!imageResponse.ok) continue;
    const arrayBuffer = await imageResponse.arrayBuffer();
    images.push(Buffer.from(arrayBuffer).toString("base64"));
  }
  return images;
}

async function prepareGeneratedImageForDelivery(base64: string, ratio: ImageRatio) {
  if (ratio !== "1:1") return base64;
  const output = await sharp(Buffer.from(base64, "base64"))
    .rotate()
    .resize(1600, 1600, {
      fit: "contain",
      position: "centre",
      background: { r: 255, g: 255, b: 255, alpha: 1 },
    })
    .flatten({ background: { r: 255, g: 255, b: 255 } })
    .png({ compressionLevel: 9 })
    .toBuffer();
  return output.toString("base64");
}

async function requestImageBatch(input: {
  apiKey: string;
  imageApiUrl: string;
  model: string;
  prompt: string;
  ratio: ImageRatio;
  quality: ImageQuality;
  referenceAssetIds: string[];
  count: number;
}) {
  let upstream: Awaited<ReturnType<typeof openAiFetch>>;

  if (input.imageApiUrl.includes("api.openai.com") && input.referenceAssetIds.length) {
    const form = new FormData();
    form.append("model", input.model);
    form.append("prompt", input.prompt);
    form.append("size", imageSizes[input.ratio]);
    form.append("quality", input.quality);
    if (input.count > 1) form.append("n", String(input.count));
    for (const id of input.referenceAssetIds) {
      const extension = id.split(".").pop()!;
      const mime = extension === "jpg" ? "image/jpeg" : `image/${extension}`;
      const bytes = await readFile(join(uploadDirectory, id));
      form.append("image[]", new File([new Uint8Array(bytes)], id, { type: mime }));
    }
    upstream = await openAiFetch(openAiImageEditApiUrl, {
      method: "POST",
      headers: imageRequestHeaders(input.apiKey, false),
      body: form,
      dispatcher: openAiDispatcher,
    });
  } else {
    const body: Record<string, unknown> = {
      model: input.model,
      prompt: input.prompt,
    };
    if (input.imageApiUrl.includes("api.openai.com")) {
      body.size = imageSizes[input.ratio];
      body.quality = input.quality;
      if (input.count > 1) body.n = input.count;
    } else {
      body.aspect_ratio = input.ratio;
      body.quality = input.quality;
      body.output_format = "png";
    }
    if (input.referenceAssetIds.length) {
      const references = await referenceImageDataUrls(input.referenceAssetIds);
      if (input.imageApiUrl.includes("openrouter.ai")) {
        body.input_references = references.map((dataUrl) => ({
          type: "image_url",
          image_url: { url: dataUrl },
        }));
      } else {
        body.images = references;
      }
    }

    upstream = await openAiFetch(
      input.imageApiUrl.includes("api.openai.com") ? openAiImageGenerationApiUrl : input.imageApiUrl,
      {
        method: "POST",
        headers: imageRequestHeaders(input.apiKey),
        body: JSON.stringify(body),
        dispatcher: openAiDispatcher,
      },
    );
  }

  const upstreamBody = await upstream.json().catch(() => ({})) as {
    data?: Array<{ b64_json?: string; url?: string }>;
    error?: { code?: string; message?: string };
  };

  if (!upstream.ok) {
    const code = upstreamBody.error?.code
      || (upstream.status === 402 ? "billing_hard_limit_reached" : `http_${upstream.status}`);
    throw new ImageProviderError(upstream.status, code, imageProviderFriendlyMessage(code, upstream.status));
  }

  return collectImageBase64FromResponse(upstreamBody.data);
}

async function generateImageBase64s(input: {
  apiKey: string;
  imageApiUrl: string;
  model: string;
  prompt: string;
  ratio: ImageRatio;
  quality: ImageQuality;
  referenceAssetIds: string[];
  count: number;
  startIndex?: number;
  totalCount?: number;
  onImage?: (image: { base64: string; label: string; index: number }) => Promise<void>;
}) {
  const startIndex = Math.max(0, input.startIndex ?? 0);
  const totalCount = Math.max(input.count + startIndex, input.totalCount ?? input.count);
  const plan = buildImagePromptPlan(input.prompt, totalCount).slice(startIndex, startIndex + input.count);
  const images: Array<{ base64: string; label: string }> = [];

  for (let offset = 0; offset < plan.length; offset += 1) {
    const item = plan[offset];
    const batch = await requestImageBatch({ ...input, prompt: item.prompt, count: 1 });
    const base64 = batch[0];
    if (!base64) break;
    const deliveryBase64 = await prepareGeneratedImageForDelivery(base64, input.ratio);
    images.push({ base64: deliveryBase64, label: item.label });
    await input.onImage?.({ base64: deliveryBase64, label: item.label, index: startIndex + offset });
  }
  return images;
}

app.get("/api/ai/status", (request: AuthenticatedRequest, response) => {
  const apiUrl = configuredImageApiUrl();
  response.json(publicAiStatusForEmployee({
    configured: Boolean(process.env.OPENAI_API_KEY),
    model: configuredImageModel(apiUrl),
    proxyConfigured: Boolean(openAiDispatcher),
    lastFailure: lastImageApiFailure,
  }, request.employee!));
});

function detailedProductFactCount(value: string) {
  const basicIdentity = /^(?:商品名称|品牌|商品类型|商品类目|类目|站点|product\s+name|brand|product\s+type|category|marketplace)\s*[:：]/i;
  return value
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/^[-*•]\s*/, ""))
    .filter((line) => line.length >= 4 && !basicIdentity.test(line) && !/[:：]\s*$/.test(line))
    .length;
}

app.post("/api/ai/listings/generate", requireRoles("管理员", "运营"), async (request: AuthenticatedRequest, response) => {
  const input = request.body as {
    listingId?: string;
    generationMode?: "competitor_first" | "product_facts";
    competitorUrl?: string;
    competitorContent?: string;
    productFacts?: string;
    instructions?: string;
  };
  const listing = db.data.listings.find((item) => item.id === input.listingId);
  if (!listing) {
    response.status(404).json({ error: "Listing 草稿不存在，请刷新后重试" });
    return;
  }

  const generationMode = input.generationMode === "product_facts" ? "product_facts" : "competitor_first";
  const competitorContent = String(input.competitorContent ?? "").trim().slice(0, 8_000);
  const productFacts = String(input.productFacts ?? "").trim().slice(0, 6_000);
  const instructions = String(input.instructions ?? "").trim().slice(0, 2_000);
  let competitor: CompetitorReference | undefined;
  let competitorResult: {
    snapshot?: CompetitorSnapshot;
    status: "fetched" | "blocked" | "unavailable";
    error?: string;
  } = { status: "unavailable" };

  if (generationMode === "competitor_first") {
    try {
      competitor = parseCompetitorProductUrl(String(input.competitorUrl ?? "").slice(0, 2_000));
    } catch (error) {
      response.status(400).json({ error: error instanceof Error ? error.message : "竞品链接无效" });
      return;
    }
    competitorResult = await fetchCompetitorSnapshot(competitor);
    if (!competitorResult.snapshot && !competitorContent) {
      response.status(422).json({
        code: "COMPETITOR_PAGE_UNAVAILABLE",
        asin: competitor.asin,
        error: competitorResult.error || `已识别 ${competitor.sourceLabel} 竞品编号，但暂时无法读取该商品页，请稍后重试`,
      });
      return;
    }
  } else if (detailedProductFactCount(productFacts) < 3 && productFacts.length < 80) {
    response.status(400).json({
      code: "PRODUCT_FACTS_INCOMPLETE",
      error: "请至少填写 3 条已核实的商品事实，例如材质、尺寸、包装数量、功能、兼容性或使用场景",
    });
    return;
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    response.status(503).json({ error: "AI 文案服务尚未配置，请管理员检查 .env.local" });
    return;
  }

  const product = db.data.products.find((item) => item.sku.trim().toUpperCase() === listing.sku.trim().toUpperCase());
  const messages = buildListingGenerationMessages({
    generationMode,
    marketplaceName: listing.marketplaceName,
    productType: listing.productType,
    sku: listing.sku,
    brand: listing.brand || product?.brand || "",
    productName: product?.name || listing.title,
    category: product?.category || listing.productType,
    existingTitle: listing.title,
    existingBulletPoints: listing.bulletPoints,
    existingDescription: listing.description,
    existingSearchTerms: listing.searchTerms,
    competitor,
    competitorSnapshot: competitorResult.snapshot as CompetitorSnapshot | undefined,
    manualCompetitorContent: competitorContent,
    productFacts,
    instructions,
  });
  const textApiUrl = configuredTextApiUrl();
  const model = configuredTextModel(textApiUrl);

  try {
    const upstream = await openAiFetch(textApiUrl, {
      method: "POST",
      headers: imageRequestHeaders(apiKey),
      body: JSON.stringify({
        model,
        temperature: 0.2,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: messages.system },
          { role: "user", content: messages.user },
        ],
      }),
      dispatcher: openAiDispatcher,
      signal: AbortSignal.timeout(90_000),
    });
    const upstreamBody = await upstream.json().catch(() => ({})) as {
      choices?: Array<{ message?: { content?: unknown } }>;
      error?: { code?: string; message?: string };
    };
    if (!upstream.ok) {
      response.status(502).json({
        code: upstreamBody.error?.code || `http_${upstream.status}`,
        error: textProviderFriendlyMessage(upstream.status),
      });
      return;
    }

    const rawContent = chatMessageText(upstreamBody.choices?.[0]?.message?.content);
    if (!rawContent) {
      response.status(502).json({ error: "AI 文案服务没有返回可用内容，请重试" });
      return;
    }
    const copy = normalizeGeneratedListingCopy(parseListingModelJson(rawContent));
    if (!copy.title && !copy.bulletPoints.length && !copy.description) {
      response.status(502).json({ error: "AI 返回的 Listing 内容不完整，请重试" });
      return;
    }
    const compliance = validateGeneratedListingCopy(copy, listing.productType);
    const generatedAt = new Date().toISOString();
    const version = db.data.listingGenerations.filter((item) => item.listingId === listing.id).length + 1;
    const generation: ListingGenerationRecord = {
      id: randomUUID(),
      listingId: listing.id,
      version,
      sku: listing.sku,
      marketplaceName: listing.marketplaceName,
      productType: listing.productType,
      brand: listing.brand || product?.brand || "",
      generatedById: request.employee!.id,
      generatedByName: request.employee!.name,
      competitorAsin: competitor?.asin,
      competitorSource: competitor?.source,
      competitorExternalId: competitor?.externalId,
      competitorUrl: competitor?.canonicalUrl,
      competitorTitle: competitorResult.snapshot?.title,
      model,
      generationMode,
      title: copy.title,
      bulletPoints: copy.bulletPoints,
      description: copy.description,
      searchTerms: copy.searchTerms,
      compliance,
      generatedAt,
    };
    db.data.listingGenerations.unshift(generation);
    db.data.activities.push({
      id: randomUUID(),
      employeeId: request.employee!.id,
      type: "LISTING_GENERATED",
      entityType: "listing",
      entityId: listing.id,
      quantity: 1,
      metadata: {
        generationId: generation.id,
        version,
        generationMode,
        competitorSource: competitor?.source,
        competitorExternalId: competitor?.externalId,
        competitorAsin: competitor?.asin,
        model,
      },
      createdAt: generatedAt,
    });
    await db.write();
    response.json({
      generationId: generation.id,
      version,
      copy,
      compliance,
      model,
      generationMode,
      ...(competitor ? {
        competitor: {
          source: competitor.source,
          sourceLabel: competitor.sourceLabel,
          externalId: competitor.externalId,
          asin: competitor.asin,
          marketplace: competitor.marketplace,
          canonicalUrl: competitor.canonicalUrl,
          sourceStatus: competitorResult.status,
          extractedTitle: competitorResult.snapshot?.title,
          extractedBrand: competitorResult.snapshot?.brand,
          manualContentUsed: Boolean(competitorContent),
        },
      } : {}),
    });
  } catch (error) {
    const message = error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError")
      ? "AI 文案生成超时，请稍后重试"
      : error instanceof SyntaxError
        ? "AI 返回格式异常，请重试"
        : error instanceof Error
          ? error.message
          : "AI 文案生成失败，请稍后重试";
    response.status(502).json({ error: message });
  }
});

app.get("/api/ai/images", requireRoles("管理员", "运营", "设计"), (request: AuthenticatedRequest, response) => {
  const limit = Math.min(50, Math.max(1, Number(request.query.limit ?? 24)));
  const offset = Math.max(0, Number(request.query.offset ?? 0));
  const paged = request.query.paged === "1";
  const viewer = request.employee!;
  const visibleAssets = viewer.role === "管理员"
    ? db.data.generatedAssets
    : db.data.generatedAssets.filter((asset) => asset.ownerId === viewer.id);
  const sortedAssets = [...visibleAssets]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  const assets = sortedAssets
    .slice(offset, offset + limit)
    .map((asset) => {
      const owner = db.data.employees.find((employee) => employee.id === asset.ownerId);
      return {
        ...asset,
        url: `/api/assets/images/${asset.id}`,
        ownerName: publicAssetOwnerName(owner, viewer, asset.ownerName),
      };
    });
  if (!paged) {
    response.json(assets);
    return;
  }
  const nextOffset = offset + assets.length;
  response.json({
    items: assets,
    total: sortedAssets.length,
    offset,
    nextOffset,
    hasMore: nextOffset < sortedAssets.length,
  });
});

app.post("/api/ai/images/generate", async (request: AuthenticatedRequest, response) => {
  if (!canCreateImageGenerationJob(request.employee!)) {
    response.status(403).json({ error: "当前账号没有创建 AI 生图任务的权限" });
    return;
  }
  const input = request.body as {
    prompt?: string;
    ratio?: ImageRatio;
    quality?: ImageQuality;
    count?: ImageCount;
    referenceAssetIds?: string[];
    templateId?: string;
    templateTitle?: string;
    jobId?: string;
  };
  const prompt = input.prompt?.trim() ?? "";
  const ratio = input.ratio ?? "1:1";
  const quality = input.quality ?? "medium";
  const count = normalizeImageCount(input.count, 1);
  const referenceAssetIds = [...new Set(input.referenceAssetIds ?? [])].slice(0, 4);
  const apiKey = process.env.OPENAI_API_KEY;
  const imageApiUrl = configuredImageApiUrl();
  const model = configuredImageModel(imageApiUrl);
  const workerJob = input.jobId
    ? db.data.imageJobs.find((job) => job.id === input.jobId && job.ownerId === request.employee!.id)
    : undefined;

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
  if (!count) {
    response.status(400).json({ error: "生成数量无效，请选择 1–7 张" });
    return;
  }
  if (input.jobId && !workerJob) {
    response.status(404).json({ error: "后台生图任务不存在", code: "image_job_not_found" });
    return;
  }

  const existingAssets = workerJob
    ? db.data.generatedAssets
      .filter((asset) => asset.generationJobId === workerJob.id)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .slice(0, count)
    : [];

  const resultPayload = (assets: GeneratedAsset[], dataUrls = new Map<string, string>()) => {
    const results = assets.map((asset) => ({
      ...asset,
      url: `/api/assets/images/${asset.id}`,
      dataUrl: dataUrls.get(asset.id),
      ownerName: request.employee!.name,
    }));
    return {
      ...results[0],
      ids: assets.map((asset) => asset.id),
      results,
      count: assets.length,
    };
  };

  if (workerJob && existingAssets.length >= count) {
    const completedAt = existingAssets.at(-1)?.createdAt ?? new Date().toISOString();
    workerJob.status = "succeeded";
    workerJob.progress = 100;
    workerJob.resultAssetId = existingAssets[0].id;
    workerJob.resultAssetIds = existingAssets.map((asset) => asset.id);
    workerJob.errorCode = undefined;
    workerJob.errorMessage = undefined;
    workerJob.completedAt = completedAt;
    workerJob.updatedAt = completedAt;
    workerJob.nextRetryAt = undefined;
    await cleanupJobReferences(workerJob);
    await db.write();
    response.status(200).json(resultPayload(existingAssets));
    return;
  }
  if (referenceAssetIds.some((id) => !/^[a-f0-9-]+\.(jpg|png|webp)$/.test(id))) {
    response.status(400).json({ error: "参考图编号无效" });
    return;
  }
  if (hasInvalidOwnedReferenceAsset(referenceAssetIds, db.data.uploadedAssets, request.employee!.id)) {
    response.status(400).json({ error: "参考图不存在或不属于当前账号" });
    return;
  }

  try {
    const persistedAssets = [...existingAssets];
    const dataUrls = new Map<string, string>();
    const remainingCount = count - persistedAssets.length;
    const generatedImages = await generateImageBase64s({
      apiKey,
      imageApiUrl,
      model,
      prompt: imageProviderPrompt(prompt, referenceAssetIds.length),
      ratio,
      quality,
      referenceAssetIds,
      count: remainingCount,
      startIndex: persistedAssets.length,
      totalCount: count,
      onImage: async ({ base64, label }) => {
        const createdAt = new Date().toISOString();
        const id = `${randomUUID()}.png`;
        await writeFile(join(uploadDirectory, id), Buffer.from(base64, "base64"), { flag: "wx" });
        const asset: GeneratedAsset = {
          id,
          ownerId: request.employee!.id,
          ownerName: request.employee!.name,
          generationJobId: workerJob?.id,
          generationLabel: label,
          prompt,
          ratio,
          quality,
          model,
          size: imageDeliverySizes[ratio],
          templateId: input.templateId,
          templateTitle: input.templateTitle,
          referenceCount: referenceAssetIds.length,
          createdAt,
        };
        persistedAssets.push(asset);
        dataUrls.set(id, `data:image/png;base64,${base64}`);
        db.data.generatedAssets.push(asset);
        db.data.activities.push({
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
            count: 1,
            generationJobId: workerJob?.id,
            generationLabel: label,
            templateId: input.templateId,
            templateTitle: input.templateTitle,
            referenceCount: referenceAssetIds.length,
          },
          createdAt,
        });
        if (workerJob) {
          workerJob.resultAssetId = persistedAssets[0].id;
          workerJob.resultAssetIds = persistedAssets.map((item) => item.id);
          workerJob.progress = Math.min(95, 35 + Math.round((persistedAssets.length / count) * 60));
          workerJob.updatedAt = createdAt;
        }
        await db.write();
      },
    });
    if (!generatedImages.length && !persistedAssets.length) {
      response.status(502).json({ error: "AI 服务没有返回图片，请重新生成", code: "empty_result" });
      return;
    }
    if (persistedAssets.length < count) {
      response.status(502).json({
        error: `AI 服务只返回了 ${persistedAssets.length}/${count} 张图片，系统会从缺失位置继续重试`,
        code: "partial_result",
        ids: persistedAssets.map((asset) => asset.id),
      });
      return;
    }
    lastImageApiFailure = null;
    if (workerJob) {
      const completedAt = new Date().toISOString();
      workerJob.status = "succeeded";
      workerJob.progress = 100;
      workerJob.resultAssetId = persistedAssets[0].id;
      workerJob.resultAssetIds = persistedAssets.map((asset) => asset.id);
      workerJob.errorCode = undefined;
      workerJob.errorMessage = undefined;
      workerJob.completedAt = completedAt;
      workerJob.updatedAt = completedAt;
      workerJob.nextRetryAt = undefined;
      await cleanupJobReferences(workerJob);
      await db.write();
    }
    response.status(existingAssets.length ? 200 : 201).json(resultPayload(persistedAssets, dataUrls));
  } catch (error) {
    if (error instanceof ImageProviderError) {
      lastImageApiFailure = {
        code: error.code,
        at: new Date().toISOString(),
      };
      response.status(error.status >= 500 ? 502 : 400).json({
        error: error.message,
        code: error.code,
      });
      return;
    }
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
    || code === "partial_result"
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
  const completedCount = job.resultAssetIds?.length ?? (job.resultAssetId ? 1 : 0);
  job.progress = completedCount && job.count
    ? Math.min(90, 5 + Math.round((completedCount / job.count) * 80))
    : 5;
  job.errorCode = code;
  job.errorMessage = `${message}，系统将在 ${Math.ceil(delay / 1000)} 秒后自动重试`;
  job.completedAt = undefined;
  job.nextRetryAt = retryAt.toISOString();
  job.updatedAt = new Date().toISOString();
  enqueueImageJob(job.id, delay);
  return true;
}

function publicImageJob(job: ImageGenerationJob, viewer?: AuthenticatedRequest["employee"]) {
  const resultAssetIds = job.resultAssetIds?.length
    ? job.resultAssetIds
    : job.resultAssetId
      ? [job.resultAssetId]
      : [];
  const assets = resultAssetIds
    .map((id) => db.data.generatedAssets.find((item) => item.id === id))
    .filter((asset): asset is GeneratedAsset => Boolean(asset));
  const owner = db.data.employees.find((employee) => employee.id === job.ownerId);
  const ownerName = viewer ? publicAssetOwnerName(owner, viewer, assets[0]?.ownerName) : owner?.name ?? assets[0]?.ownerName ?? "团队成员";
  const results = assets.map((asset) => ({
    ...asset,
    url: `/api/assets/images/${asset.id}`,
    ownerName,
  }));
  return {
    ...job,
    count: job.count ?? 1,
    resultAssetIds,
    ownerName,
    result: results[0],
    results,
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

async function reconcileImageJobsWithSavedAssets() {
  let changed = false;

  for (const job of db.data.imageJobs) {
    if (job.status === "succeeded" && job.resultAssetIds?.length) continue;
    const expectedCount = job.count ?? 1;
    let matched = db.data.generatedAssets
      .filter((asset) => asset.generationJobId === job.id)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

    // Backfill jobs created before generationJobId was introduced. Old batches
    // share the same timestamp, so select one complete batch instead of merging
    // multiple automatic retries into a single task.
    if (!matched.length && !job.resultAssetIds?.length) {
      const jobCreatedAt = new Date(job.createdAt).getTime();
      const legacyCandidates = db.data.generatedAssets.filter((asset) => (
        !asset.generationJobId
        && asset.ownerId === job.ownerId
        && normalizedImagePrompt(asset.prompt) === normalizedImagePrompt(job.prompt)
        && asset.ratio === job.ratio
        && asset.quality === job.quality
        && new Date(asset.createdAt).getTime() >= jobCreatedAt
        && new Date(asset.createdAt).getTime() <= jobCreatedAt + 2 * 60 * 60 * 1000
      ));
      const batches = new Map<string, GeneratedAsset[]>();
      for (const asset of legacyCandidates) {
        const batch = batches.get(asset.createdAt) ?? [];
        batch.push(asset);
        batches.set(asset.createdAt, batch);
      }
      const completeBatch = [...batches.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .find(([, assets]) => assets.length >= expectedCount)?.[1]
        ?.slice(0, expectedCount);
      if (completeBatch?.length) {
        completeBatch.forEach((asset) => { asset.generationJobId = job.id; });
        matched = completeBatch;
        changed = true;
      }
    }

    if (!matched.length && job.resultAssetIds?.length) {
      matched = job.resultAssetIds
        .map((id) => db.data.generatedAssets.find((asset) => asset.id === id))
        .filter((asset): asset is GeneratedAsset => Boolean(asset));
    }
    if (!matched.length) continue;

    job.resultAssetId = matched[0].id;
    job.resultAssetIds = matched.slice(0, expectedCount).map((asset) => asset.id);
    if (matched.length >= expectedCount) {
      job.status = "succeeded";
      job.progress = 100;
      job.errorCode = undefined;
      job.errorMessage = undefined;
      job.nextRetryAt = undefined;
      job.completedAt = matched[expectedCount - 1].createdAt;
      job.updatedAt = job.completedAt;
      await cleanupJobReferences(job);
    } else {
      job.progress = Math.min(90, 5 + Math.round((matched.length / expectedCount) * 80));
    }
    changed = true;
  }

  if (changed) await db.write();
  return changed;
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
        jobId: job.id,
        prompt: job.prompt,
        ratio: job.ratio,
        quality: job.quality,
        count: job.count ?? 1,
        referenceAssetIds: job.referenceAssetIds,
        templateId: job.templateId,
        templateTitle: job.templateTitle,
      }),
    });
    const body = await upstream.json() as { id?: string; ids?: string[]; error?: string; code?: string };
    const completedAt = new Date().toISOString();
    const resultAssetIds = body.ids?.length ? body.ids : body.id ? [body.id] : [];
    if (!upstream.ok || !resultAssetIds.length) {
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
      job.resultAssetId = resultAssetIds[0];
      job.resultAssetIds = resultAssetIds;
      job.completedAt = completedAt;
      job.updatedAt = completedAt;
      await cleanupJobReferences(job);
    }
    await db.write();
  } catch {
    if (job.status === "succeeded" && job.resultAssetIds?.length) {
      await db.write();
      return;
    }
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

function normalizedImagePrompt(value: string) {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function findRecentDuplicateImageJob(input: {
  ownerId: string;
  prompt: string;
  ratio: ImageRatio;
  quality: ImageQuality;
  count: number;
}) {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  return db.data.imageJobs
    .filter((job) => job.ownerId === input.ownerId)
    .filter((job) => new Date(job.createdAt).getTime() >= cutoff)
    .filter((job) => normalizedImagePrompt(job.prompt) === normalizedImagePrompt(input.prompt))
    .filter((job) => job.ratio === input.ratio && job.quality === input.quality && (job.count ?? 1) === input.count)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
}

app.post("/api/ai/jobs", async (request: AuthenticatedRequest, response) => {
  if (!canCreateImageGenerationJob(request.employee!)) {
    response.status(403).json({ error: "当前账号没有创建 AI 生图任务的权限" });
    return;
  }
  const input = request.body as {
    prompt?: string;
    ratio?: ImageRatio;
    quality?: ImageQuality;
    count?: ImageCount;
    referenceAssetIds?: string[];
    templateId?: string;
    templateTitle?: string;
    allowDuplicate?: boolean;
  };
  const prompt = input.prompt?.trim() ?? "";
  const ratio = input.ratio ?? "1:1";
  const quality = input.quality ?? "medium";
  const count = normalizeImageCount(input.count, 1);
  const referenceAssetIds = [...new Set(input.referenceAssetIds ?? [])].slice(0, 4);
  if (!prompt || prompt.length > 4000) {
    response.status(400).json({ error: "请输入 1–4000 字的图片提示词" });
    return;
  }
  if (!(ratio in imageSizes) || !["low", "medium", "high"].includes(quality)) {
    response.status(400).json({ error: "图片比例或质量参数无效" });
    return;
  }
  if (!count) {
    response.status(400).json({ error: "生成数量无效，请选择 1–7 张" });
    return;
  }
  const invalidReference = hasInvalidOwnedReferenceAsset(referenceAssetIds, db.data.uploadedAssets, request.employee!.id);
  if (invalidReference) {
    response.status(400).json({ error: "参考图不存在或不属于当前账号" });
    return;
  }
  const duplicate = findRecentDuplicateImageJob({
    ownerId: request.employee!.id,
    prompt,
    ratio,
    quality,
    count,
  });
  if (duplicate && input.allowDuplicate !== true) {
    response.status(409).json({
      error: duplicate.status === "queued" || duplicate.status === "running"
        ? "相同提示词和参数的任务正在生成，请勿重复提交"
        : "24 小时内已提交过相同提示词和参数的任务，是否仍要再次生成？",
      code: "duplicate_image_job",
      duplicateJob: {
        id: duplicate.id,
        status: duplicate.status,
        createdAt: duplicate.createdAt,
        resultCount: duplicate.resultAssetIds?.length ?? (duplicate.resultAssetId ? 1 : 0),
      },
    });
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
    count,
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
  response.status(202).json(publicImageJob(job, request.employee));
});

app.get("/api/ai/jobs", async (request: AuthenticatedRequest, response) => {
  await reconcileImageJobsWithSavedAssets();
  const limit = Math.min(50, Math.max(1, Number(request.query.limit ?? 20)));
  const jobs = db.data.imageJobs
    .filter((job) => canAccessImageJob(job, request.employee!))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, limit)
    .map((job) => publicImageJob(job, request.employee));
  response.json(jobs);
});

app.get("/api/ai/jobs/:id", (request: AuthenticatedRequest, response) => {
  const job = db.data.imageJobs.find((item) => item.id === String(request.params.id));
  if (!job) {
    response.status(404).json({ error: "生成任务不存在" });
    return;
  }
  if (!canAccessImageJob(job, request.employee!)) {
    response.status(403).json({ error: "没有权限查看该生成任务" });
    return;
  }
  response.json(publicImageJob(job, request.employee));
});

app.post("/api/ai/jobs/:id/retry", async (request: AuthenticatedRequest, response) => {
  const job = db.data.imageJobs.find((item) => item.id === String(request.params.id));
  if (!job) {
    response.status(404).json({ error: "生成任务不存在" });
    return;
  }
  if (!canAccessImageJob(job, request.employee!)) {
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
  job.resultAssetId = undefined;
  job.resultAssetIds = undefined;
  job.completedAt = undefined;
  job.nextRetryAt = undefined;
  job.updatedAt = new Date().toISOString();
  await db.write();
  enqueueImageJob(job.id);
  response.status(202).json(publicImageJob(job, request.employee));
});

app.delete("/api/ai/jobs/:id", async (request: AuthenticatedRequest, response) => {
  const job = db.data.imageJobs.find((item) => item.id === String(request.params.id));
  if (!job) {
    response.status(404).json({ error: "生成任务不存在" });
    return;
  }
  if (!canAccessImageJob(job, request.employee!)) {
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
  if (!input.username?.trim() || !input.name?.trim() || !input.password || !input.department?.trim() || !input.role) {
    response.status(400).json({ error: "用户名、姓名、初始密码、部门和角色为必填项" });
    return;
  }
  if (db.data.employees.some((item) => item.username.toLowerCase() === input.username!.trim().toLowerCase())) {
    response.status(409).json({ error: "用户名已经存在" });
    return;
  }
  if (!isValidUsername(input.username.trim())) {
    response.status(400).json({ error: "用户名需为 3–40 位字母、数字、点、下划线或短横线" });
    return;
  }
  if (!["管理员", "运营", "设计", "审核"].includes(input.role)) {
    response.status(400).json({ error: "账号角色无效" });
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
    department: input.department.trim(),
    role: input.role,
    active: true,
    mustChangePassword: true,
  };
  db.data.employees.push(employee);
  await db.write();
  response.status(201).json(publicEmployee(employee));
});

app.patch("/api/employees/:id", requireRoles("管理员"), async (request: AuthenticatedRequest, response) => {
  const employee = db.data.employees.find((item) => item.id === request.params.id);
  if (!employee) {
    response.status(404).json({ error: "员工不存在" });
    return;
  }
  const result = validateEmployeeUpdate(
    employee,
    request.body as EmployeeUpdateInput,
    db.data.employees,
    request.employee!.id,
  );
  if (result.error || !result.patch) {
    response.status(400).json({ error: result.error ?? "员工资料无效" });
    return;
  }
  Object.assign(employee, result.patch);
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

app.post("/api/activity", (_request: AuthenticatedRequest, response) => {
  const result = directActivityWriteDisabledResponse();
  response.status(result.status).json(result.body);
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
      imagesGenerated: count("IMAGE_GENERATED"),
      tasksCreated: count("TASK_CREATED"),
      reviewsCompleted: count("REVIEW_APPROVED") + count("REVIEW_REJECTED"),
      listingsDrafted: count("LISTING_DRAFTED"),
      listingsGenerated: count("LISTING_GENERATED"),
      listingsSaved: count("LISTING_SAVED"),
      listingsPublished: count("LISTING_PUBLISHED"),
      lastActiveAt: own.sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]?.createdAt ?? null,
    };
  });
  response.json({ days, metrics, events: events.length });
});

app.get("/api/me/statistics", (request: AuthenticatedRequest, response) => {
  const days = Math.max(1, Math.min(365, Number(request.query.days ?? 30)));
  const after = Date.now() - days * 86400000;
  const employee = request.employee!;
  const events = db.data.activities.filter(
    (event) => event.employeeId === employee.id && new Date(event.createdAt).getTime() >= after,
  );
  const count = (type: ActivityType) => events
    .filter((event) => event.type === type)
    .reduce((sum, event) => sum + event.quantity, 0);
  response.json({
    days,
    scope: "personal",
    imagesGenerated: count("IMAGE_GENERATED"),
    listingsGenerated: count("LISTING_GENERATED"),
    listingsSaved: count("LISTING_SAVED"),
    reviewsCompleted: count("REVIEW_APPROVED") + count("REVIEW_REJECTED"),
    tasksCreated: count("TASK_CREATED"),
    lastActiveAt: [...events].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]?.createdAt ?? null,
  });
});

app.get("/api/listing-history", requireRoles("管理员", "运营"), (request: AuthenticatedRequest, response) => {
  const viewer = request.employee!;
  const limit = Math.min(200, Math.max(1, Number(request.query.limit ?? 50)));
  const records = visibleListingGenerationsForEmployee(db.data.listingGenerations, viewer);
  response.json([...records].sort((a, b) => b.generatedAt.localeCompare(a.generatedAt)).slice(0, limit));
});

app.delete("/api/listing-history/:id", requireRoles("管理员", "运营"), async (request: AuthenticatedRequest, response) => {
  const record = db.data.listingGenerations.find((item) => item.id === request.params.id);
  if (!record || record.deletedAt) {
    response.status(404).json({ error: "Listing 历史版本不存在或已删除" });
    return;
  }
  if (!canDeleteListingGeneration(record, request.employee!)) {
    response.status(403).json({ error: "只能删除自己生成的 Listing 历史版本" });
    return;
  }
  record.deletedAt = new Date().toISOString();
  record.deletedById = request.employee!.id;
  record.deletedByName = request.employee!.name;
  await db.write();
  response.json({ ok: true });
});

app.post("/api/listing-history/:id/restore", requireRoles("管理员", "运营"), async (request: AuthenticatedRequest, response) => {
  const record = db.data.listingGenerations.find((item) => item.id === request.params.id);
  if (!record) {
    response.status(404).json({ error: "Listing 历史版本不存在" });
    return;
  }
  if (!canRestoreListingGeneration(record, request.employee!)) {
    response.status(403).json({ error: "只能恢复自己生成的 Listing 历史版本" });
    return;
  }
  const listing = db.data.listings.find((item) => item.id === record.listingId);
  if (!listing) {
    response.status(404).json({ error: "关联的 Listing 草稿已不存在" });
    return;
  }
  const copy = record.savedCopy ?? record;
  listing.title = copy.title;
  listing.bulletPoints = [...copy.bulletPoints];
  listing.description = copy.description;
  listing.searchTerms = copy.searchTerms;
  listing.competitorAsin = record.competitorAsin;
  listing.competitorUrl = record.competitorUrl;
  listing.aiGeneratedAt = record.generatedAt;
  listing.latestGenerationId = record.id;
  listing.lastEditedById = request.employee!.id;
  listing.lastEditedByName = request.employee!.name;
  listing.updatedAt = new Date().toISOString();
  listing.issues = validateListing(listing);
  listing.status = listing.issues.length ? "待完善" : amazonConfigured() ? "可提交" : "基础通过";
  await db.write();
  response.json(publicListingForEmployee(listing, request.employee!));
});

app.get("/api/listings", requireRoles("管理员", "运营"), (request: AuthenticatedRequest, response) => {
  response.json([...db.data.listings]
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .map((listing) => publicListingForEmployee(listing, request.employee!)));
});

app.post("/api/listings", requireRoles("管理员", "运营"), async (request: AuthenticatedRequest, response) => {
  const input = request.body as Partial<AmazonListing>;
  const conflict = findListingConflict(db.data.listings, {
    sku: input.sku ?? "",
    marketplaceId: input.marketplaceId ?? "ATVPDKIKX0DER",
  });
  if (conflict) {
    response.status(409).json({
      code: "LISTING_ALREADY_EXISTS",
      error: `${conflict.sku} 在 ${conflict.marketplaceName} 已有 Listing，请直接编辑原草稿`,
      listingId: conflict.id,
      listing: publicListingForEmployee(conflict, request.employee!),
    });
    return;
  }
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
    ownerName: request.employee!.name,
    createdAt: new Date().toISOString(),
    lastEditedById: request.employee!.id,
    lastEditedByName: request.employee!.name,
    asin: input.asin?.trim() || undefined,
    competitorUrl: input.competitorUrl?.trim() || undefined,
    competitorAsin: input.competitorAsin?.trim() || undefined,
    aiGeneratedAt: input.aiGeneratedAt,
    templateFileName: input.templateFileName,
    templateValues: input.templateValues,
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
  response.status(201).json(publicListingForEmployee(listing, request.employee!));
});

app.put("/api/listings/:id", requireRoles("管理员", "运营"), async (request: AuthenticatedRequest, response) => {
  const listing = db.data.listings.find((item) => item.id === request.params.id);
  if (!listing) {
    response.status(404).json({ error: "Listing 不存在" });
    return;
  }
  const input = request.body as Partial<AmazonListing>;
  const nextSku = input.sku ?? listing.sku;
  const nextMarketplaceId = input.marketplaceId ?? listing.marketplaceId;
  const conflict = findListingConflict(
    db.data.listings,
    { sku: nextSku, marketplaceId: nextMarketplaceId },
    listing.id,
  );
  if (conflict) {
    response.status(409).json({
      code: "LISTING_ALREADY_EXISTS",
      error: `${conflict.sku} 在 ${conflict.marketplaceName} 已有 Listing，不能保存为重复草稿`,
      listingId: conflict.id,
      listing: publicListingForEmployee(conflict, request.employee!),
    });
    return;
  }
  const editableFields: Array<keyof AmazonListing> = [
    "sku",
    "marketplaceId",
    "marketplaceName",
    "productType",
    "title",
    "brand",
    "description",
    "bulletPoints",
    "searchTerms",
    "price",
    "currency",
    "quantity",
    "asin",
    "competitorUrl",
    "competitorAsin",
    "aiGeneratedAt",
    "templateFileName",
    "templateValues",
  ];
  let requestedGeneration: ListingGenerationRecord | undefined;
  if (input.latestGenerationId && input.latestGenerationId !== listing.latestGenerationId) {
    requestedGeneration = db.data.listingGenerations.find(
      (item) => item.id === input.latestGenerationId && item.listingId === listing.id,
    );
    if (!requestedGeneration) {
      response.status(400).json({ error: "Listing 生成版本无效或不属于当前草稿" });
      return;
    }
    if (!canRestoreListingGeneration(requestedGeneration, request.employee!)) {
      response.status(403).json({ error: "不能采用其他员工生成的 Listing 版本" });
      return;
    }
  }
  for (const field of editableFields) {
    if (field in input) (listing as unknown as Record<string, unknown>)[field] = input[field];
  }
  if (requestedGeneration) listing.latestGenerationId = requestedGeneration.id;
  listing.updatedAt = new Date().toISOString();
  listing.lastEditedById = request.employee!.id;
  listing.lastEditedByName = request.employee!.name;
  listing.issues = validateListing(listing);
  listing.status = listing.issues.length ? "待完善" : amazonConfigured() ? "可提交" : "基础通过";
  if (listing.latestGenerationId) {
    const generation = db.data.listingGenerations.find(
      (item) => item.id === listing.latestGenerationId && item.listingId === listing.id,
    );
    if (generation && canRestoreListingGeneration(generation, request.employee!)) {
      generation.adoptedAt = listing.updatedAt;
      generation.adoptedById = request.employee!.id;
      generation.adoptedByName = request.employee!.name;
      generation.savedCopy = {
        title: listing.title,
        bulletPoints: [...listing.bulletPoints],
        description: listing.description,
        searchTerms: listing.searchTerms,
      };
    }
  }
  db.data.activities.push({
    id: randomUUID(),
    employeeId: request.employee!.id,
    type: "LISTING_SAVED",
    entityType: "listing",
    entityId: listing.id,
    quantity: 1,
    metadata: listing.latestGenerationId ? { generationId: listing.latestGenerationId } : undefined,
    createdAt: listing.updatedAt,
  });
  await db.write();
  response.json(publicListingForEmployee(listing, request.employee!));
});

app.delete("/api/listings/:id", requireRoles("管理员", "运营"), async (request, response) => {
  const index = db.data.listings.findIndex((item) => item.id === request.params.id);
  if (index < 0) {
    response.status(404).json({ error: "Listing 不存在" });
    return;
  }
  const listing = db.data.listings[index];
  if (!canDeleteLocalListing(listing.status)) {
    response.status(409).json({
      code: "LISTING_DELETE_REQUIRES_AMAZON",
      error: "该 Listing 已进入 Amazon 处理流程，不能只删除本地记录，请使用 Amazon 下架流程",
    });
    return;
  }
  db.data.listings.splice(index, 1);
  await db.write();
  response.json({ ok: true });
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

app.get("/api/amazon/product-types", requireRoles("管理员", "运营"), async (request, response) => {
  if (!amazonConnectorReady()) {
    response.status(409).json({
      code: "AMAZON_NOT_READY",
      error: "连接 Amazon 后才能在线搜索最新类目；当前仍可上传 Seller Central 类目模板",
    });
    return;
  }
  const marketplaceId = String(request.query.marketplaceId ?? "");
  const keywords = String(request.query.keywords ?? "").trim().slice(0, 120);
  const itemName = String(request.query.itemName ?? "").trim().slice(0, 200);
  const locale = String(request.query.locale ?? "").trim().slice(0, 10);
  if (!marketplaceId) {
    response.status(400).json({ error: "请选择 Amazon 站点" });
    return;
  }
  if (!keywords && !itemName) {
    response.status(400).json({ error: "请输入类目关键词或商品名称" });
    return;
  }
  try {
    const productTypes = await searchAmazonProductTypes(
      marketplaceId,
      keywords ? { keywords, locale } : { itemName, locale },
    );
    response.json({ productTypes });
  } catch (error) {
    response.status(502).json({ error: error instanceof Error ? error.message : "Amazon 类目搜索失败" });
  }
});

app.get("/api/amazon/product-types/:productType/definition", requireRoles("管理员", "运营"), async (request, response) => {
  if (!amazonConnectorReady()) {
    response.status(409).json({ code: "AMAZON_NOT_READY", error: "Amazon SP-API 尚未授权或未确认启用" });
    return;
  }
  const marketplaceId = String(request.query.marketplaceId ?? "");
  const locale = String(request.query.locale ?? "").trim().slice(0, 10);
  const parentage = String(request.query.parentageLevel ?? "NONE").toUpperCase();
  if (!["NONE", "CHILD", "PARENT"].includes(parentage)) {
    response.status(400).json({ error: "parentageLevel 仅支持 NONE、CHILD 或 PARENT" });
    return;
  }
  try {
    const result = await getAmazonProductTypeDefinition(
      marketplaceId,
      String(request.params.productType),
      {
        locale,
        parentageLevel: parentage as "NONE" | "CHILD" | "PARENT",
      },
    );
    response.json(summarizeAmazonProductType(result.definition, result.schema));
  } catch (error) {
    response.status(502).json({ error: error instanceof Error ? error.message : "Amazon 类目规则获取失败" });
  }
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
  void reconcileImageJobsWithSavedAssets().then(() => {
    db.data.imageJobs.filter((job) => job.status === "queued").forEach((job) => {
      const delay = job.nextRetryAt
        ? Math.max(20, new Date(job.nextRetryAt).getTime() - Date.now())
        : 20;
      enqueueImageJob(job.id, delay);
    });
  }).catch((error) => console.error("Huacai image job recovery failed", error));
  void ensureDailyBackup().catch((error) => console.error("Huacai daily backup failed", error));
  const backupTimer = setInterval(() => {
    void ensureDailyBackup().catch((error) => console.error("Huacai scheduled backup failed", error));
  }, 60 * 60 * 1000);
  backupTimer.unref();
  if (!process.env.INITIAL_ADMIN_PASSWORD) {
    console.warn("未配置 INITIAL_ADMIN_PASSWORD；正式部署前请在 .env.local 设置强初始密码，服务日志不会显示任何口令");
  }
});
