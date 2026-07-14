export type ActivityType =
  | "SKU_CREATED"
  | "IMAGE_UPLOADED"
  | "IMAGE_GENERATED"
  | "TASK_CREATED"
  | "REVIEW_APPROVED"
  | "REVIEW_REJECTED"
  | "LISTING_DRAFTED"
  | "LISTING_GENERATED"
  | "LISTING_SAVED"
  | "LISTING_VALIDATED"
  | "LISTING_PUBLISHED";

export interface Employee {
  id: string;
  username: string;
  passwordHash: string;
  name: string;
  department: string;
  role: "管理员" | "运营" | "设计" | "审核";
  active: boolean;
  mustChangePassword?: boolean;
}

export interface AuthSession {
  id: string;
  tokenHash: string;
  employeeId: string;
  createdAt: string;
  expiresAt: string;
}

export interface NotificationRecord {
  id: string;
  employeeId: string;
  type: "TASK_ASSIGNED" | "REVIEW_REQUESTED" | "TASK_APPROVED" | "TASK_REJECTED";
  title: string;
  message: string;
  entityId: string;
  entityType?: "task";
  targetPage?: "tasks" | "reviews";
  metadata?: {
    sku?: string;
    productName?: string;
    taskType?: WorkspaceTask["type"];
    version?: number;
    dueAt?: string;
    action?: "open_task" | "review_task" | "revise_task" | "view_result";
  };
  createdAt: string;
  readAt?: string;
}

export interface ActivityEvent {
  id: string;
  employeeId: string;
  type: ActivityType;
  entityType: "product" | "asset" | "task" | "review" | "listing";
  entityId: string;
  quantity: number;
  metadata?: Record<string, unknown>;
  createdAt: string;
}

export type ListingStatus = "草稿" | "待完善" | "基础通过" | "可提交" | "提交中" | "已发布" | "失败";

export interface AmazonListing {
  id: string;
  sku: string;
  marketplaceId: string;
  marketplaceName: string;
  productType: string;
  title: string;
  brand: string;
  description: string;
  bulletPoints: string[];
  searchTerms: string;
  price: number;
  currency: string;
  quantity: number;
  status: ListingStatus;
  ownerId: string;
  ownerName?: string;
  createdAt?: string;
  lastEditedById?: string;
  lastEditedByName?: string;
  latestGenerationId?: string;
  asin?: string;
  competitorUrl?: string;
  competitorAsin?: string;
  aiGeneratedAt?: string;
  templateFileName?: string;
  templateValues?: Record<string, string>;
  amazonSubmissionId?: string;
  issues: string[];
  updatedAt: string;
}

export interface ListingGenerationRecord {
  id: string;
  listingId: string;
  version: number;
  sku: string;
  marketplaceName: string;
  productType: string;
  brand: string;
  generatedById: string;
  generatedByName: string;
  competitorAsin: string;
  competitorUrl: string;
  competitorTitle?: string;
  model: string;
  generationMode: "competitor_first";
  title: string;
  bulletPoints: string[];
  description: string;
  searchTerms: string;
  compliance: {
    compliant: boolean;
    issues: Array<{
      code: string;
      field: string;
      severity: "error" | "warning";
      message: string;
      index?: number;
    }>;
  };
  generatedAt: string;
  adoptedAt?: string;
  adoptedById?: string;
  adoptedByName?: string;
  savedCopy?: {
    title: string;
    bulletPoints: string[];
    description: string;
    searchTerms: string;
  };
}

export interface GeneratedAsset {
  id: string;
  ownerId: string;
  ownerName?: string;
  generationJobId?: string;
  generationLabel?: string;
  prompt: string;
  ratio: "1:1" | "16:9" | "3:4";
  quality: "low" | "medium" | "high";
  model: string;
  size: string;
  templateId?: string;
  templateTitle?: string;
  referenceCount: number;
  createdAt: string;
}

export interface UploadedAssetRecord {
  id: string;
  ownerId: string;
  name: string;
  type: string;
  size: number;
  taskId: string;
  productId: string;
  purpose?: "input" | "output" | "reference";
  createdAt: string;
}

export interface WorkspaceProduct {
  id: string;
  sku: string;
  asin?: string;
  name: string;
  brand: string;
  category: string;
  marketplace: string;
  status: string;
  imageCount: number;
  updatedAt: string;
}

export interface WorkspaceTask {
  id: string;
  productId: string;
  sku: string;
  productName: string;
  type: string;
  status: string;
  progress: number;
  owner: string;
  createdById?: string;
  createdByName?: string;
  assignedToId?: string;
  assignedToName?: string;
  dueAt?: string;
  updatedAt: string;
  inputAssetIds?: string[];
  inputCount?: number;
  templateId?: string;
  templateTitle?: string;
  templatePrompt?: string;
  outputAssetIds?: string[];
  outputCount?: number;
  version?: number;
  submittedAt?: string;
  reviewComment?: string;
  reviewedBy?: string;
  reviewedAt?: string;
  reviewHistory?: Array<{
    version: number;
    approved: boolean;
    comment: string;
    reviewer: string;
    reviewedAt: string;
  }>;
}

export interface ImageGenerationJob {
    id: string;
    ownerId: string;
    status: "queued" | "running" | "succeeded" | "failed";
    progress: number;
    prompt: string;
    ratio: "1:1" | "16:9" | "3:4";
    quality: "low" | "medium" | "high";
    count?: number;
    referenceAssetIds: string[];
    templateId?: string;
    templateTitle?: string;
    resultAssetId?: string;
    resultAssetIds?: string[];
    errorCode?: string;
    errorMessage?: string;
    attempts: number;
  createdAt: string;
  updatedAt: string;
    startedAt?: string;
    completedAt?: string;
    nextRetryAt?: string;
  }

export interface DatabaseSchema {
  employees: Employee[];
  sessions: AuthSession[];
  activities: ActivityEvent[];
  listings: AmazonListing[];
  listingGenerations: ListingGenerationRecord[];
  generatedAssets: GeneratedAsset[];
  uploadedAssets: UploadedAssetRecord[];
  products: WorkspaceProduct[];
  tasks: WorkspaceTask[];
  imageJobs: ImageGenerationJob[];
  notifications: NotificationRecord[];
}
