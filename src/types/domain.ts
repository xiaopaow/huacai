export type PageKey =
  | "dashboard"
  | "products"
  | "create"
  | "tasks"
  | "reviews"
  | "performance"
  | "listings"
  | "listingHistory"
  | "assets"
  | "assetHistory"
  | "settings";

export type ProductStatus = "资料待完善" | "可生成" | "生产中" | "已交付";
export type TaskStatus = "草稿" | "待生成" | "生成中" | "待审核" | "已驳回" | "已通过";
export type Marketplace = "美国站" | "英国站" | "德国站" | "日本站";

export interface Product {
  id: string;
  sku: string;
  asin?: string;
  name: string;
  brand: string;
  category: string;
  marketplace: Marketplace;
  status: ProductStatus;
  imageCount: number;
  updatedAt: string;
}

export interface GenerationTask {
  id: string;
  productId: string;
  sku: string;
  productName: string;
  type: "Amazon 六图套图" | "Amazon 白底主图" | "场景图";
  status: TaskStatus;
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

export interface WorkspaceState {
  products: Product[];
  tasks: GenerationTask[];
}

export interface EmployeeMetric {
  id: string;
  name: string;
  department: string;
  role: string;
  skuCreated: number;
  imagesUploaded: number;
  imagesGenerated: number;
  tasksCreated: number;
  reviewsCompleted: number;
  listingsDrafted: number;
  listingsGenerated: number;
  listingsSaved: number;
  listingsPublished: number;
  lastActiveAt: string | null;
}

export interface EmployeeAccount {
  id: string;
  username: string;
  name: string;
  department: string;
  role: "管理员" | "运营" | "设计" | "审核";
  active: boolean;
  mustChangePassword?: boolean;
}

export interface ActivityEvent {
  id: string;
  employeeId: string;
  type: string;
  entityType: string;
  entityId: string;
  quantity: number;
  createdAt: string;
}

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
  status: "草稿" | "待完善" | "基础通过" | "可提交" | "提交中" | "已发布" | "失败";
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
  competitorSource?: "amazon" | "etsy";
  competitorExternalId?: string;
  competitorAsin?: string;
  competitorUrl?: string;
  competitorTitle?: string;
  model: string;
  generationMode: "competitor_first" | "product_facts";
  title: string;
  bulletPoints: string[];
  description: string;
  searchTerms: string;
  compliance: {
    compliant: boolean;
    issues: Array<{ code: string; field: string; severity: "error" | "warning"; message: string; index?: number }>;
  };
  generatedAt: string;
  deletedAt?: string;
  deletedById?: string;
  deletedByName?: string;
  adoptedAt?: string;
  adoptedById?: string;
  adoptedByName?: string;
  savedCopy?: Pick<AmazonListing, "title" | "bulletPoints" | "description" | "searchTerms">;
}
