import type { DatabaseSchema } from "./types.js";

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

export interface BuildSystemHealthInput {
  data: DatabaseSchema;
  generatedAt?: string;
  demoData?: {
    detected: boolean;
    productCount: number;
    taskCount: number;
    listingCount: number;
    activityCount: number;
  };
  databaseFileReady: boolean;
  uploadDirectoryReady: boolean;
  backupDirectoryReady: boolean;
  backupCount: number;
  latestBackupAt?: string;
  backupRetention: number;
  openAiConfigured: boolean;
  openAiLastFailure?: { code: string; at: string } | null;
  amazonConfigured: boolean;
  amazonConnectorReady: boolean;
  amazonMode: string;
  initialAdminPasswordConfigured?: boolean;
  initialAdminPasswordUsesDefault?: boolean;
  initialEmployeePasswordUsesDefault?: boolean;
  apiPort: number;
  nodeVersion: string;
}

export function rollupHealth(items: Pick<SystemHealthItem, "status">[]): SystemHealthStatus {
  if (items.some((item) => item.status === "error")) return "error";
  if (items.some((item) => item.status === "warning")) return "warning";
  return "ok";
}

function normalizeSku(value: string) {
  return value.trim().toUpperCase();
}

export function buildSystemHealthReport(input: BuildSystemHealthInput): SystemHealthReport {
  const activeAdminCount = input.data.employees.filter((employee) => employee.active && employee.role === "管理员").length;
  const activeRoleCounts = {
    ops: input.data.employees.filter((employee) => employee.active && employee.role === "运营").length,
    design: input.data.employees.filter((employee) => employee.active && employee.role === "设计").length,
    review: input.data.employees.filter((employee) => employee.active && employee.role === "审核").length,
  };
  const missingWorkflowRoles = [
    activeRoleCounts.ops > 0 ? "" : "运营",
    activeRoleCounts.design > 0 ? "" : "设计",
    activeRoleCounts.review > 0 ? "" : "审核",
  ].filter(Boolean);
  const activeProductionAssigneeIds = new Set(
    input.data.employees
      .filter((employee) => employee.active && (employee.role === "设计" || employee.role === "管理员"))
      .map((employee) => employee.id),
  );
  const unfinishedTasks = input.data.tasks.filter((task) => task.status !== "已通过");
  const unassignedTaskCount = unfinishedTasks.filter((task) => !task.assignedToId).length;
  const invalidAssigneeTaskCount = unfinishedTasks.filter((task) =>
    Boolean(task.assignedToId) && !activeProductionAssigneeIds.has(task.assignedToId!),
  ).length;
  const routingIssueCount = unassignedTaskCount + invalidAssigneeTaskCount;
  const productById = new Map(input.data.products.map((product) => [product.id, product]));
  const productSkus = new Set(input.data.products.map((product) => normalizeSku(product.sku)));
  const taskById = new Map(input.data.tasks.map((task) => [task.id, task]));
  const uploadedAssetById = new Map(input.data.uploadedAssets.map((asset) => [asset.id, asset]));
  const taskMissingProductCount = input.data.tasks.filter((task) => !productById.has(task.productId)).length;
  const taskSkuMismatchCount = input.data.tasks.filter((task) => {
    const product = productById.get(task.productId);
    return Boolean(product) && normalizeSku(product!.sku) !== normalizeSku(task.sku);
  }).length;
  const listingMissingProductCount = input.data.listings.filter(
    (listing) => !productSkus.has(normalizeSku(listing.sku)),
  ).length;
  const assetMissingTaskCount = input.data.uploadedAssets.filter((asset) => !taskById.has(asset.taskId)).length;
  const assetMissingProductCount = input.data.uploadedAssets.filter((asset) => !productById.has(asset.productId)).length;
  const assetWrongTaskProductCount = input.data.uploadedAssets.filter((asset) => {
    const task = taskById.get(asset.taskId);
    return Boolean(task) && task!.productId !== asset.productId;
  }).length;
  const taskMissingReferencedAssetCount = input.data.tasks.filter((task) =>
    [...(task.inputAssetIds ?? []), ...(task.outputAssetIds ?? [])].some((assetId) => !uploadedAssetById.has(assetId)),
  ).length;
  const relationIssueCount = taskMissingProductCount
    + taskSkuMismatchCount
    + listingMissingProductCount
    + assetMissingTaskCount
    + assetMissingProductCount
    + assetWrongTaskProductCount
    + taskMissingReferencedAssetCount;
  const passwordChangeRequiredCount = input.data.employees.filter((employee) => employee.active && employee.mustChangePassword).length;
  const weakInitialPassword = input.initialAdminPasswordUsesDefault
    || input.initialEmployeePasswordUsesDefault
    || input.initialAdminPasswordConfigured === false;
  const summary = {
    products: input.data.products.length,
    tasks: input.data.tasks.length,
    listings: input.data.listings.length,
    assets: input.data.generatedAssets.length + input.data.uploadedAssets.length,
  };

  const items: SystemHealthItem[] = [
    {
      key: "database",
      label: "共享数据库",
      status: input.databaseFileReady ? "ok" : "error",
      detail: input.databaseFileReady
        ? `已连接，当前 ${summary.products} 个 SKU、${summary.tasks} 个任务、${summary.listings} 条 Listing`
        : "未找到 data/huacai-db.json，系统无法稳定保存业务数据",
      action: input.databaseFileReady ? undefined : "检查数据卷或先启动一次服务初始化数据库",
    },
    {
      key: "data-relations",
      label: "业务数据关联",
      status: relationIssueCount ? "warning" : "ok",
      detail: relationIssueCount
        ? `发现 ${relationIssueCount} 个关联异常：${taskMissingProductCount} 个任务缺少 SKU 商品、${taskSkuMismatchCount} 个任务 SKU 与商品库不一致、${listingMissingProductCount} 条 Listing 未匹配商品库、${assetMissingTaskCount} 个素材缺少任务、${assetMissingProductCount} 个素材缺少 SKU 商品、${assetWrongTaskProductCount} 个素材 SKU 与任务不一致、${taskMissingReferencedAssetCount} 个任务引用了不存在的素材`
        : "任务、Listing、商品图片与 SKU 商品库的基础关联正常",
      action: relationIssueCount ? "上线前先备份，再修复或清理缺失关联，避免任务、图片和 Listing 无法追溯" : undefined,
    },
    {
      key: "uploads",
      label: "图片上传目录",
      status: input.uploadDirectoryReady ? "ok" : "error",
      detail: input.uploadDirectoryReady
        ? `图片目录可用，当前记录 ${summary.assets} 个素材`
        : "data/uploads 不可用，商品原图和生成图无法保存",
      action: input.uploadDirectoryReady ? undefined : "检查服务器写入权限或 Docker volume",
    },
    {
      key: "backups",
      label: "数据备份",
      status: input.backupDirectoryReady ? (input.backupCount > 0 ? "ok" : "warning") : "error",
      detail: input.backupDirectoryReady
        ? input.backupCount > 0
          ? `已有 ${input.backupCount} 份快照，最近备份 ${input.latestBackupAt ?? "未知"}，保留最近 ${input.backupRetention} 份`
          : `备份目录可用，但还没有快照；默认保留最近 ${input.backupRetention} 份`
        : "data/backups 不可用，无法做恢复保护",
      action: input.backupDirectoryReady && input.backupCount === 0 ? "上线前先点一次“立即备份”" : undefined,
    },
    {
      key: "ai",
      label: "AI 生图服务",
      status: input.openAiConfigured ? (input.openAiLastFailure ? "warning" : "ok") : "warning",
      detail: input.openAiConfigured
        ? input.openAiLastFailure
          ? `已配置 API Key，但最近一次调用失败：${input.openAiLastFailure.code}`
          : "已配置 API Key，图片生成接口可进入实际调用"
        : "未配置 OPENAI_API_KEY；系统可跑任务流，但不能自动生图",
      action: input.openAiConfigured ? undefined : "在 .env.local 配置 OPENAI_API_KEY",
    },
    {
      key: "amazon",
      label: "Amazon 店铺连接",
      status: input.amazonConnectorReady ? "ok" : input.amazonConfigured ? "warning" : "warning",
      detail: input.amazonConnectorReady
        ? `SP-API 已启用，当前为 ${input.amazonMode} 模式，可尝试直连提交`
        : input.amazonConfigured
          ? `SP-API 参数已填写，当前为 ${input.amazonMode} 模式，但尚未确认启用直连`
          : "尚未连接 Amazon；仍可做 SKU、图片任务、审核、Listing 草稿和表格导出",
      action: input.amazonConnectorReady ? undefined : "正式上线前由管理员完成 Seller Central 授权",
    },
    {
      key: "security",
      label: "账号安全",
      status: activeAdminCount < 1 ? "error" : weakInitialPassword ? "warning" : "ok",
      detail: activeAdminCount < 1
        ? "当前没有启用中的管理员账号，无法维护员工权限"
        : weakInitialPassword
          ? `已启用 ${activeAdminCount} 个管理员，但初始密码仍是默认值或未在环境变量中明确配置；${passwordChangeRequiredCount} 个账号需要首次改密`
          : `已启用 ${activeAdminCount} 个管理员，${passwordChangeRequiredCount} 个账号需要首次改密`,
      action: activeAdminCount < 1
        ? "请恢复或创建至少一个管理员账号"
        : weakInitialPassword
          ? "上线前在 .env.local 设置独立强密码，并让所有账号完成首次改密"
          : undefined,
    },
    {
      key: "team-roles",
      label: "团队角色覆盖",
      status: activeAdminCount < 1 ? "error" : missingWorkflowRoles.length ? "warning" : "ok",
      detail: missingWorkflowRoles.length
        ? `当前仍缺少启用中的 ${missingWorkflowRoles.join("、")} 账号；管理员可以代处理，但真实协作流程会卡在对应环节`
        : `已覆盖运营 ${activeRoleCounts.ops} 人、设计 ${activeRoleCounts.design} 人、审核 ${activeRoleCounts.review} 人`,
      action: missingWorkflowRoles.length ? `上线前建议创建或启用：${missingWorkflowRoles.join("、")} 账号` : undefined,
    },
    {
      key: "task-routing",
      label: "任务负责人有效性",
      status: routingIssueCount ? "warning" : "ok",
      detail: routingIssueCount
        ? `有 ${routingIssueCount} 个未完成任务需要重新确认负责人：${unassignedTaskCount} 个待分配、${invalidAssigneeTaskCount} 个负责人已停用或角色无效`
        : unfinishedTasks.length
          ? `当前 ${unfinishedTasks.length} 个未完成任务都已分配给启用中的设计/管理员`
          : "当前没有未完成任务需要调度",
      action: routingIssueCount ? "上线前到任务中心重新分配负责人，避免任务看似有人处理但实际卡住" : undefined,
    },
    {
      key: "demo-data",
      label: "演示数据清理",
      status: input.demoData?.detected ? "warning" : "ok",
      detail: input.demoData?.detected
        ? `检测到演示数据：${input.demoData.productCount} 个 SKU、${input.demoData.taskCount} 个任务、${input.demoData.listingCount} 条 Listing、${input.demoData.activityCount} 条统计记录`
        : "未检测到旧版演示数据，员工统计和商品库更适合正式使用",
      action: input.demoData?.detected ? "上线前在系统设置中执行“清理演示数据”" : undefined,
    },
    {
      key: "runtime",
      label: "运行环境",
      status: "ok",
      detail: `Node ${input.nodeVersion} · API 端口 ${input.apiPort} · Amazon ${input.amazonMode}`,
    },
  ];

  return {
    status: rollupHealth(items),
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    summary,
    items,
  };
}
