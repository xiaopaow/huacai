import type {
  ActivityEvent,
  AmazonListing,
  EmployeeAccount,
  EmployeeMetric,
  GenerationTask,
  ListingGenerationRecord,
  Product,
  WorkspaceState,
} from "../types/domain";

const tokenKey = "huacai-auth-token";

export class ApiError extends Error {
  status: number;
  code?: string;
  data: Record<string, unknown>;

  constructor(message: string, status: number, data: Record<string, unknown> = {}) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = typeof data.code === "string" ? data.code : undefined;
    this.data = data;
  }
}

export function hasAuthToken() {
  return Boolean(localStorage.getItem(tokenKey));
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const token = localStorage.getItem(tokenKey);
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...options?.headers,
      },
      ...options,
    });
  } catch {
    throw new Error("后台服务未启动，请在项目目录运行 npm run dev");
  }
  const text = await response.text();
  let body: { error?: string } & Record<string, unknown> = {};
  if (text) {
    try {
      body = JSON.parse(text) as typeof body;
    } catch {
      body = { error: response.ok ? "后台返回了无法识别的数据" : "后台服务未启动或代理连接失败，请运行 npm run dev" };
    }
  } else if (!response.ok) {
    body = { error: "后台服务未启动或没有响应，请运行 npm run dev" };
  }
  if (response.status === 401 && path !== "/auth/login") {
    localStorage.removeItem(tokenKey);
    window.dispatchEvent(new Event("huacai:unauthorized"));
  }
  if (!response.ok) throw new ApiError(body.error ?? "请求失败", response.status, body);
  return body as T;
}

export async function getEmployeeAnalytics(days = 30) {
  return request<{ days: number; metrics: EmployeeMetric[]; events: number }>(`/analytics/employees?days=${days}`);
}

export async function getCurrentUser() {
  return request<EmployeeAccount>("/me");
}

export function getTeamDirectory() {
  return request<Array<Pick<EmployeeAccount, "id" | "name" | "department" | "role">>>("/team/directory");
}

export function changeMyPassword(currentPassword: string, newPassword: string) {
  return request<{ ok: boolean; user: EmployeeAccount }>("/me/password", {
    method: "POST",
    body: JSON.stringify({ currentPassword, newPassword }),
  });
}

export interface WorkspaceNotification {
  id: string;
  type: "TASK_ASSIGNED" | "REVIEW_REQUESTED" | "TASK_APPROVED" | "TASK_REJECTED";
  title: string;
  message: string;
  entityId: string;
  entityType?: "task";
  targetPage?: "tasks" | "reviews";
  metadata?: {
    sku?: string;
    productName?: string;
    taskType?: string;
    version?: number;
    dueAt?: string;
    action?: "open_task" | "review_task" | "revise_task" | "view_result";
  };
  createdAt: string;
  readAt?: string;
}

export function getNotifications(limit = 30) {
  return request<WorkspaceNotification[]>(`/notifications?limit=${limit}`);
}

export function markNotificationRead(id: string) {
  return request<WorkspaceNotification>(`/notifications/${id}/read`, { method: "PATCH" });
}

export function markAllNotificationsRead() {
  return request<{ ok: boolean }>("/notifications/read-all", { method: "POST" });
}

export function getWorkspace() {
  return request<WorkspaceState>("/workspace");
}

export interface WorkspaceSummary {
  generatedThisMonth: number;
  listingsGeneratedThisMonth: number;
  statisticsScope: "team" | "personal";
  monthlyQuota: number;
  activeImageJobs: number;
  productCount: number;
  taskCount: number;
}

export function getWorkspaceSummary() {
  return request<WorkspaceSummary>("/workspace/summary");
}

export interface DatabaseBackup {
  name: string;
  size: number;
  createdAt: string;
  assetsIncluded: boolean;
}

export interface DemoDataStatus {
  detected: boolean;
  productCount: number;
  taskCount: number;
  listingCount: number;
  activityCount: number;
}

export type SystemHealthStatus = "ok" | "warning" | "error";

export interface SystemHealthItem {
  key: string;
  label: string;
  status: SystemHealthStatus;
  detail: string;
  action?: string;
}

export interface SystemHealthReport {
  status: SystemHealthStatus;
  generatedAt: string;
  summary: {
    products: number;
    tasks: number;
    listings: number;
    assets: number;
  };
  items: SystemHealthItem[];
}

export function getSystemHealth() {
  return request<SystemHealthReport>("/admin/health");
}

export function getDatabaseBackups() {
  return request<DatabaseBackup[]>("/admin/backups");
}

export function createDatabaseBackup() {
  return request<DatabaseBackup>("/admin/backups", { method: "POST" });
}

export function restoreDatabaseBackup(name: string) {
  return request<{ ok: boolean; safetyBackup: DatabaseBackup; assetsRestored: boolean }>(
    `/admin/backups/${encodeURIComponent(name)}/restore`,
    { method: "POST" },
  );
}

export function getDemoDataStatus() {
  return request<DemoDataStatus>("/admin/demo-data");
}

export function removeDemoData() {
  return request<{
    ok: boolean;
    removed: DemoDataStatus;
    safetyBackup: DatabaseBackup;
  }>("/admin/demo-data", { method: "DELETE" });
}

export function createWorkspaceProduct(product: Product) {
  return request<Product>("/products", { method: "POST", body: JSON.stringify(product) });
}

export function importWorkspaceProducts(products: Product[]) {
  return request<{ products: Product[]; importedCount: number }>("/products/import", {
    method: "POST",
    body: JSON.stringify({ products }),
  });
}

export function updateWorkspaceProduct(product: Product) {
  return request<Product>(`/products/${product.id}`, { method: "PUT", body: JSON.stringify(product) });
}

export function deleteWorkspaceProduct(id: string) {
  return request<{ ok: boolean }>(`/products/${id}`, { method: "DELETE" });
}

export function createWorkspaceTask(task: GenerationTask) {
  return request<{ task: GenerationTask; product?: Product }>("/tasks", {
    method: "POST",
    body: JSON.stringify(task),
  });
}

export function submitWorkspaceTaskOutputs(id: string, outputAssetIds: string[]) {
  return request<GenerationTask>(`/tasks/${id}/submit`, {
    method: "POST",
    body: JSON.stringify({ outputAssetIds }),
  });
}

export function updateWorkspaceTaskAssignment(
  id: string,
  input: { assignedToId?: string; dueAt?: string },
) {
  return request<GenerationTask>(`/tasks/${id}/assignment`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export function reviewWorkspaceTask(id: string, approved: boolean, comment: string) {
  return request<GenerationTask>(`/tasks/${id}/review`, {
    method: "POST",
    body: JSON.stringify({ approved, comment }),
  });
}

export async function login(username: string, password: string) {
  const result = await request<{ token: string; user: EmployeeAccount }>("/auth/login", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
  localStorage.setItem(tokenKey, result.token);
  return result.user;
}

export async function logout() {
  try {
    await request<{ ok: boolean }>("/auth/logout", { method: "POST" });
  } finally {
    localStorage.removeItem(tokenKey);
  }
}

export async function getEmployees() {
  return request<EmployeeAccount[]>("/employees");
}

export async function createEmployee(input: {
  username: string;
  password: string;
  name: string;
  department: string;
  role: EmployeeAccount["role"];
}) {
  return request<EmployeeAccount>("/employees", { method: "POST", body: JSON.stringify(input) });
}

export async function updateEmployee(id: string, input: Partial<Pick<EmployeeAccount, "username" | "name" | "department" | "role" | "active">>) {
  return request<EmployeeAccount>(`/employees/${id}`, { method: "PATCH", body: JSON.stringify(input) });
}

export function resetEmployeePassword(id: string, password: string) {
  return request<{ ok: boolean }>(`/employees/${id}/reset-password`, {
    method: "POST",
    body: JSON.stringify({ password }),
  });
}

export async function getActivities(limit = 30) {
  return request<ActivityEvent[]>(`/activity?limit=${limit}`);
}

export async function getListings() {
  return request<AmazonListing[]>("/listings");
}

export async function createListing(input: Partial<AmazonListing>) {
  return request<AmazonListing>("/listings", { method: "POST", body: JSON.stringify(input) });
}

export async function updateListing(listing: AmazonListing) {
  return request<AmazonListing>(`/listings/${listing.id}`, { method: "PUT", body: JSON.stringify(listing) });
}

export interface GeneratedListingCopy {
  title: string;
  bulletPoints: string[];
  description: string;
  searchTerms: string;
  competitorInsights: string[];
  assumptions: string[];
  warnings: string[];
}

export interface ListingComplianceIssue {
  code: string;
  field: "title" | "bulletPoints" | "description" | "searchTerms" | "general";
  severity: "error" | "warning";
  message: string;
  index?: number;
}

export interface ListingGenerationResult {
  generationId: string;
  version: number;
  copy: GeneratedListingCopy;
  compliance: {
    titleLimit: number;
    issues: ListingComplianceIssue[];
    compliant: boolean;
  };
  model: string;
  generationMode: "competitor_first";
  competitor: {
    asin: string;
    marketplace: string;
    canonicalUrl: string;
    sourceStatus: "fetched" | "blocked" | "unavailable";
    extractedTitle?: string;
    extractedBrand?: string;
    manualContentUsed: boolean;
  };
}

export function generateListingCopy(input: { listingId: string; competitorUrl: string }) {
  return request<ListingGenerationResult>("/ai/listings/generate", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function getListingHistory(limit = 50) {
  return request<ListingGenerationRecord[]>(`/listing-history?limit=${limit}`);
}

export function restoreListingGeneration(id: string) {
  return request<AmazonListing>(`/listing-history/${id}/restore`, { method: "POST" });
}

export interface PersonalStatistics {
  days: number;
  scope: "personal";
  imagesGenerated: number;
  listingsGenerated: number;
  listingsSaved: number;
  reviewsCompleted: number;
  tasksCreated: number;
  lastActiveAt: string | null;
}

export function getMyStatistics(days = 30) {
  return request<PersonalStatistics>(`/me/statistics?days=${days}`);
}

export async function deleteListing(id: string) {
  return request<{ ok: boolean }>(`/listings/${id}`, { method: "DELETE" });
}

export async function validateListing(id: string) {
  return request<{ listing: AmazonListing; payloadPreview: unknown; amazonSchemaValidation: string }>(
    `/listings/${id}/validate`,
    { method: "POST" },
  );
}

export async function submitListing(id: string) {
  return request<{ listing: AmazonListing; amazon: { status?: string; submissionId?: string } }>(
    `/listings/${id}/submit`,
    { method: "POST" },
  );
}

export async function refreshListingStatus(id: string) {
  return request<{ listing: AmazonListing; amazon: { summaries?: Array<{ status?: string[] }> } }>(
    `/listings/${id}/refresh-status`,
    { method: "POST" },
  );
}

export async function getAmazonStatus() {
  return request<{ configured: boolean; connectorReady: boolean; required: string[]; mode: string }>("/amazon/status");
}

export interface AmazonProductTypeSummary {
  name: string;
  displayName: string;
  marketplaceIds: string[];
  productTypeVersion: {
    version: string;
    latest: boolean;
    releaseCandidate: boolean;
  };
}

export interface AmazonProductTypeFieldSummary {
  name: string;
  title: string;
  description: string;
  group: string;
  groupTitle: string;
  required: boolean;
  enumValues: string[];
  minItems?: number;
  maxItems?: number;
}

export interface AmazonProductTypeDefinitionSummary {
  productType: string;
  displayName: string;
  marketplaceIds: string[];
  locale: string;
  version: {
    version: string;
    latest: boolean;
    releaseCandidate: boolean;
  };
  schemaChecksum: string;
  fields: AmazonProductTypeFieldSummary[];
  requiredCount: number;
}

export function searchAmazonProductTypes(
  marketplaceId: string,
  query: { keywords?: string; itemName?: string; locale?: string },
) {
  const parameters = new URLSearchParams({ marketplaceId });
  if (query.keywords) parameters.set("keywords", query.keywords);
  if (query.itemName) parameters.set("itemName", query.itemName);
  if (query.locale) parameters.set("locale", query.locale);
  return request<{ productTypes: AmazonProductTypeSummary[] }>(`/amazon/product-types?${parameters}`);
}

export function getAmazonProductTypeDefinition(
  marketplaceId: string,
  productType: string,
  options: { locale?: string; parentageLevel?: "NONE" | "CHILD" | "PARENT" } = {},
) {
  const parameters = new URLSearchParams({ marketplaceId });
  if (options.locale) parameters.set("locale", options.locale);
  if (options.parentageLevel) parameters.set("parentageLevel", options.parentageLevel);
  return request<AmazonProductTypeDefinitionSummary>(
    `/amazon/product-types/${encodeURIComponent(productType)}/definition?${parameters}`,
  );
}

export interface UploadedAsset {
  id: string;
  name: string;
  type: string;
  size: number;
  purpose?: "input" | "output" | "reference";
  url: string;
}

export async function uploadTaskImages(
  taskId: string,
  productId: string,
  files: File[],
  purpose: "input" | "output" | "reference",
) {
  const token = localStorage.getItem(tokenKey);
  const uploads: UploadedAsset[] = [];
  try {
    for (const file of files) {
      let response: Response;
      response = await fetch("/api/assets/images", {
        method: "POST",
        headers: {
          "Content-Type": file.type,
          "X-File-Name": encodeURIComponent(file.name),
          "X-Task-Id": taskId,
          "X-Product-Id": productId,
          "X-Asset-Purpose": purpose,
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: file,
      });

      const body = await response.json().catch(() => ({ error: "图片上传服务返回了无法识别的数据" }));
      if (response.status === 401) {
        localStorage.removeItem(tokenKey);
        window.dispatchEvent(new Event("huacai:unauthorized"));
      }
      if (!response.ok) {
        throw new Error((body as { error?: string }).error ?? `图片 ${file.name} 上传失败`);
      }
      uploads.push(body as UploadedAsset);
    }
    return uploads;
  } catch (error) {
    await Promise.allSettled(uploads.map((asset) => deleteAsset(asset.id)));
    if (error instanceof TypeError) {
      throw new Error("图片上传服务未连接，请确认后台服务正在运行");
    }
    throw error;
  }
}

export function deleteAsset(id: string) {
  return request<{ ok: boolean }>(`/assets/images/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export async function deleteAssets(ids: string[]) {
  await Promise.allSettled(ids.map(deleteAsset));
}

export interface GeneratedImage {
  id: string;
  url: string;
  dataUrl?: string;
  model: string;
  size: string;
  quality: "low" | "medium" | "high";
  prompt: string;
  ratio: "1:1" | "16:9" | "3:4";
  templateTitle?: string;
  ownerId: string;
  ownerName: string;
  createdAt: string;
}

export function generateImage(input: {
  prompt: string;
  ratio: "1:1" | "16:9" | "3:4";
  quality: "low" | "medium" | "high";
  count?: 1 | 2 | 3 | 4 | 5 | 6 | 7;
  referenceAssetIds?: string[];
  templateId?: string;
  templateTitle?: string;
}) {
  return request<GeneratedImage & { ids?: string[]; results?: GeneratedImage[]; count?: number }>("/ai/images/generate", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export interface ImageGenerationJob {
  id: string;
  ownerId: string;
  ownerName: string;
  status: "queued" | "running" | "succeeded" | "failed";
  progress: number;
  prompt: string;
  ratio: "1:1" | "16:9" | "3:4";
  quality: "low" | "medium" | "high";
  count?: 1 | 2 | 3 | 4 | 5 | 6 | 7;
  referenceAssetIds: string[];
  templateId?: string;
  templateTitle?: string;
  resultAssetId?: string;
  resultAssetIds?: string[];
  result?: GeneratedImage;
  results?: GeneratedImage[];
  errorCode?: string;
  errorMessage?: string;
  attempts: number;
  createdAt: string;
  updatedAt: string;
  nextRetryAt?: string;
}

export function createImageJob(input: {
  prompt: string;
  ratio: "1:1" | "16:9" | "3:4";
  quality: "low" | "medium" | "high";
  count: 1 | 2 | 3 | 4 | 5 | 6 | 7;
  referenceAssetIds?: string[];
  templateId?: string;
  templateTitle?: string;
  allowDuplicate?: boolean;
}) {
  return request<ImageGenerationJob>("/ai/jobs", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function getImageJobs(limit = 20) {
  return request<ImageGenerationJob[]>(`/ai/jobs?limit=${limit}`);
}

export function retryImageJob(id: string) {
  return request<ImageGenerationJob>(`/ai/jobs/${id}/retry`, { method: "POST" });
}

export function deleteImageJob(id: string) {
  return request<{ ok: boolean }>(`/ai/jobs/${id}`, { method: "DELETE" });
}

export function getGeneratedImages(limit = 24) {
  return request<GeneratedImage[]>(`/ai/images?limit=${limit}`);
}

export function getAiStatus() {
  return request<{
    configured: boolean;
    model: string;
    proxyConfigured: boolean;
    lastFailure: { code: string; at: string } | null;
  }>("/ai/status");
}

export async function getAssetObjectUrl(id: string) {
  const token = localStorage.getItem(tokenKey);
  const response = await fetch(`/api/assets/images/${encodeURIComponent(id)}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (response.status === 401) {
    localStorage.removeItem(tokenKey);
    window.dispatchEvent(new Event("huacai:unauthorized"));
  }
  if (!response.ok) throw new Error("作品图片读取失败");
  return URL.createObjectURL(await response.blob());
}
