import { useEffect, useMemo, useRef, useState } from "react";
import {
  createWorkspaceProduct,
  createWorkspaceTask,
  deleteAssets,
  deleteWorkspaceProduct,
  getAssetObjectUrl,
  getCurrentUser,
  getListings,
  getMyStatistics,
  getNotifications,
  getTeamDirectory,
  getWorkspace,
  getWorkspaceSummary,
  hasAuthToken,
  importWorkspaceProducts,
  logout,
  markAllNotificationsRead,
  markNotificationRead,
  reviewWorkspaceTask,
  submitWorkspaceTaskOutputs,
  updateWorkspaceTaskAssignment,
  updateWorkspaceProduct,
  uploadTaskImages,
  type GeneratedImage,
  type PersonalStatistics,
  type WorkspaceNotification,
} from "./lib/api";
import ListingsPage from "./pages/ListingsPage";
import LoginPage from "./pages/LoginPage";
import PerformancePage from "./pages/PerformancePage";
import SettingsPage from "./pages/SettingsPage";
import AssetsPage from "./pages/AssetsPage";
import GeneratedHistoryPage from "./pages/GeneratedHistoryPage";
import ListingHistoryPage from "./pages/ListingHistoryPage";
import { canAccessPage, firstAccessiblePage } from "./lib/pageAccess";
import { evaluateProductReadiness, type ProductReadiness } from "./lib/productReadiness";
import LogoutDialog from "./components/LogoutDialog";
import ProductDeleteDialog from "./components/ProductDeleteDialog";
import ProductImportDialog from "./components/ProductImportDialog";
import HelpCenterDialog from "./components/HelpCenterDialog";
import ecommerceHeroImage from "./assets/ecommerce-hero-v1.png";
import {
  expectedTaskInputCount,
  expectedTaskOutputCount,
  isWorkflowTaskOverdue,
  nextTaskAction,
  reviewRejectionCommentMessage,
  taskInputCreationMessage,
  taskOutputSubmissionMessage,
  taskWorkflowStage,
} from "./lib/taskWorkflow";
import { listingHandoffForTask } from "./lib/listingHandoff";
import {
  notificationActionLabel,
  notificationIcon,
  notificationMetaLine,
  notificationTargetPage,
} from "./lib/notificationWorkflow";
import type { InspirationTemplate } from "./data/templates";
import type {
  AmazonListing,
  GenerationTask,
  EmployeeAccount,
  Marketplace,
  PageKey,
  Product,
  TaskStatus,
  WorkspaceState,
} from "./types/domain";

const storageKey = "huacai-amazon-workspace-v2";

const navItems: Array<{ key: PageKey; icon: string; label: string }> = [
  { key: "dashboard", icon: "⌂", label: "工作台" },
  { key: "products", icon: "◇", label: "SKU 商品库" },
  { key: "create", icon: "✦", label: "新建生成任务" },
  { key: "listings", icon: "A", label: "Listing 中心" },
  { key: "listingHistory", icon: "◫", label: "Listing 历史" },
  { key: "tasks", icon: "▤", label: "任务中心" },
  { key: "reviews", icon: "✓", label: "审核中心" },
  { key: "performance", icon: "↗", label: "员工效率" },
  { key: "assets", icon: "▧", label: "素材库" },
  { key: "assetHistory", icon: "▣", label: "生成历史" },
  { key: "settings", icon: "⚙", label: "系统设置" },
];

const titles: Record<PageKey, { title: string; sub: string }> = {
  dashboard: { title: "Amazon 视觉工作台", sub: "今天也让每个 SKU 更接近成交。" },
  products: { title: "SKU 商品库", sub: "统一维护商品资料、原图和站点信息。" },
  create: { title: "新建生成任务", sub: "从商品资料开始，生成完整 Amazon Listing 套图。" },
  listings: { title: "AI Listing 工作台", sub: "输入单个竞品链接，生成、检查并保存 Amazon 文案草稿。" },
  listingHistory: { title: "Listing 历史库", sub: "查看每次 AI 生成版本、创建人、规则结果并恢复内容。" },
  tasks: { title: "任务中心", sub: "跟踪生成进度、失败任务与交付状态。" },
  reviews: { title: "审核中心", sub: "集中处理待审核图片和修改意见。" },
  performance: { title: "员工效率后台", sub: "基于真实操作记录查看团队产出与流程瓶颈。" },
  assets: { title: "素材库", sub: "管理品牌、商品原图和已交付视觉资产。" },
  assetHistory: { title: "生成历史", sub: "大图浏览、下载和复用团队 AI 生图作品。" },
  settings: { title: "系统设置", sub: "管理团队、权限、品牌规范和模型策略。" },
};

function loadWorkspace(): WorkspaceState {
  try {
    const saved = localStorage.getItem(storageKey);
    if (saved) return JSON.parse(saved) as WorkspaceState;
  } catch {
    // Storage may be unavailable in private browsing.
  }
  return { products: [], tasks: [] };
}

function App() {
  const [page, setPage] = useState<PageKey>("dashboard");
  const [workspace, setWorkspace] = useState<WorkspaceState>(loadWorkspace);
  const [toast, setToast] = useState("");
  const [mobileNav, setMobileNav] = useState(false);
  const [currentUser, setCurrentUser] = useState<EmployeeAccount | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [workspaceLoading, setWorkspaceLoading] = useState(true);
  const [workspaceSummary, setWorkspaceSummary] = useState({
    generatedThisMonth: 0,
    listingsGeneratedThisMonth: 0,
    statisticsScope: "personal" as "team" | "personal",
    monthlyQuota: 500,
    activeImageJobs: 0,
  });
  const [createProductId, setCreateProductId] = useState<string>();
  const [accountOpen, setAccountOpen] = useState(false);
  const [logoutConfirm, setLogoutConfirm] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const accountTriggerRef = useRef<HTMLButtonElement>(null);
  const [notifications, setNotifications] = useState<WorkspaceNotification[]>([]);
  const [notificationOpen, setNotificationOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [notificationTargetId, setNotificationTargetId] = useState("");
  const [listingFocusSku, setListingFocusSku] = useState("");
  const pendingReviewCount = workspace.tasks.filter((task) => task.status === "待审核").length;
  const unreadNotificationCount = notifications.filter((notification) => !notification.readAt).length;

  useEffect(() => {
    localStorage.setItem(storageKey, JSON.stringify(workspace));
  }, [workspace]);

  useEffect(() => {
    if (!hasAuthToken()) {
      setAuthLoading(false);
      return;
    }
    getCurrentUser().then(setCurrentUser).catch(() => setCurrentUser(null)).finally(() => setAuthLoading(false));
  }, []);

  useEffect(() => {
    if (!currentUser) return;
    if (currentUser.mustChangePassword) {
      setPage("settings");
      setWorkspaceLoading(false);
      return;
    }
    let cancelled = false;
    setWorkspaceLoading(true);
    const loadSharedWorkspace = async () => {
      try {
        const shared = await getWorkspace();
        if (!cancelled) setWorkspace(shared);
      } catch (error) {
        if (!cancelled) notify(error instanceof Error ? `${error.message}，已使用本地缓存` : "共享工作区读取失败，已使用本地缓存");
      } finally {
        if (!cancelled) setWorkspaceLoading(false);
      }
    };
    void loadSharedWorkspace();
    return () => {
      cancelled = true;
    };
  }, [currentUser?.id]);

  useEffect(() => {
    if (!currentUser || currentUser.mustChangePassword) return;
    let cancelled = false;
    const refresh = () => {
      getWorkspaceSummary().then((summary) => {
        if (!cancelled) setWorkspaceSummary(summary);
      }).catch(() => undefined);
    };
    refresh();
    const timer = window.setInterval(refresh, 30000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [currentUser?.id]);

  useEffect(() => {
    if (!currentUser || currentUser.mustChangePassword) return;
    let cancelled = false;
    const refreshNotifications = () => {
      getNotifications().then((items) => {
        if (!cancelled) setNotifications(items);
      }).catch(() => undefined);
    };
    refreshNotifications();
    const timer = window.setInterval(refreshNotifications, 15000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [currentUser?.id, currentUser?.mustChangePassword]);

  useEffect(() => {
    if (!currentUser) return;
    if (currentUser.mustChangePassword) {
      if (page !== "settings") setPage("settings");
      return;
    }
    if (!canAccessPage(currentUser.role, page)) {
      setPage(firstAccessiblePage(currentUser.role));
    }
  }, [currentUser?.role, currentUser?.mustChangePassword, page]);

  useEffect(() => {
    const handleUnauthorized = () => {
      setCurrentUser(null);
      setPage("dashboard");
      notify("登录已失效，请重新登录");
    };
    window.addEventListener("huacai:unauthorized", handleUnauthorized);
    return () => window.removeEventListener("huacai:unauthorized", handleUnauthorized);
  }, []);

  useEffect(() => {
    if (!accountOpen) return;
    const closeAccount = () => setAccountOpen(false);
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeAccount();
    };
    window.addEventListener("click", closeAccount);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("click", closeAccount);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [accountOpen]);

  useEffect(() => {
    if (!notificationOpen) return;
    const closeNotifications = () => setNotificationOpen(false);
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeNotifications();
    };
    window.addEventListener("click", closeNotifications);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("click", closeNotifications);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [notificationOpen]);

  const notify = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 2200);
  };

  const go = (target: PageKey) => {
    if (!currentUser || !canAccessPage(currentUser.role, target)) {
      notify("当前账号没有访问该功能的权限");
      return;
    }
    if (currentUser.mustChangePassword && target !== "settings") {
      notify("请先修改初始密码，再进入工作台");
      setPage("settings");
      return;
    }
    if (target !== "listings") setListingFocusSku("");
    setPage(target);
    setAccountOpen(false);
    setMobileNav(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const signOut = async () => {
    if (signingOut) return;
    setSigningOut(true);
    try {
      await logout();
      setCurrentUser(null);
      setPage("dashboard");
    } finally {
      setSigningOut(false);
      setLogoutConfirm(false);
      setAccountOpen(false);
    }
  };

  const openNotification = async (notification: WorkspaceNotification) => {
    if (!notification.readAt) {
      try {
        const updated = await markNotificationRead(notification.id);
        setNotifications((current) => current.map((item) => item.id === updated.id ? updated : item));
      } catch {
        // The task can still be opened if read-state persistence briefly fails.
      }
    }
    try {
      setWorkspace(await getWorkspace());
    } catch {
      // Keep the current workspace snapshot.
    }
    setNotificationTargetId(notification.entityId);
    setNotificationOpen(false);
    go(notificationTargetPage(notification));
  };

  const readAllNotifications = async () => {
    try {
      await markAllNotificationsRead();
      const readAt = new Date().toISOString();
      setNotifications((current) => current.map((item) => item.readAt ? item : { ...item, readAt }));
    } catch (error) {
      notify(error instanceof Error ? error.message : "通知状态更新失败");
    }
  };

  const persistNewProduct = async (product: Product): Promise<Product | undefined> => {
    try {
      const saved = await createWorkspaceProduct(product);
      setWorkspace((current) => ({
        ...current,
        products: [saved, ...current.products],
      }));
      notify(`SKU ${product.sku} 已保存到共享工作区`);
      return saved;
    } catch (error) {
      notify(error instanceof Error ? error.message : "SKU 保存失败");
      return undefined;
    }
  };

  const addProduct = async (product: Product) => {
    if (await persistNewProduct(product)) go("products");
  };

  const updateProduct = async (product: Product): Promise<Product | undefined> => {
    try {
      const saved = await updateWorkspaceProduct(product);
      setWorkspace((current) => ({
        ...current,
        products: current.products.map((item) => item.id === saved.id ? saved : item),
      }));
      notify(`SKU ${product.sku} 已同步更新`);
      return saved;
    } catch (error) {
      notify(error instanceof Error ? error.message : "SKU 更新失败");
      return undefined;
    }
  };

  const importProducts = async (products: Product[]): Promise<number> => {
    try {
      const result = await importWorkspaceProducts(products);
      setWorkspace((current) => ({
        ...current,
        products: [...result.products, ...current.products],
      }));
      notify(`已导入 ${result.importedCount} 个公司 SKU`);
      return result.importedCount;
    } catch (error) {
      notify(error instanceof Error ? error.message : "SKU 批量导入失败");
      throw error;
    }
  };

  const removeProduct = async (product: Product): Promise<boolean> => {
    if (workspace.tasks.some((task) => task.productId === product.id)) {
      notify("该商品已有生产任务，不能直接删除");
      return false;
    }
    try {
      await deleteWorkspaceProduct(product.id);
      setWorkspace((current) => ({
        ...current,
        products: current.products.filter((item) => item.id !== product.id),
      }));
      notify(`SKU ${product.sku} 已删除`);
      return true;
    } catch (error) {
      notify(error instanceof Error ? error.message : "SKU 删除失败");
      return false;
    }
  };

  const startTaskForProduct = (productId: string) => {
    setCreateProductId(productId);
    go("create");
  };

  const continueTaskToListing = (task: GenerationTask) => {
    setListingFocusSku(task.sku);
    go("listings");
  };

  const reuseGeneratedPrompt = (image: GeneratedImage) => {
    if (!currentUser) return;
    localStorage.setItem(
      `huacai-studio-draft:${currentUser.id}`,
      JSON.stringify({
        prompt: image.prompt,
        ratio: image.ratio,
        quality: image.quality,
        count: 3,
      }),
    );
    notify("已把历史作品提示词载入素材库，可以继续修改后生成");
    go("assets");
  };

  const addTask = async (task: GenerationTask, imageCount = 0) => {
    const saved = await createWorkspaceTask(task);
    setWorkspace((current) => ({
      products: current.products.map((product) =>
        product.id === task.productId
          ? saved.product ?? {
              ...product,
              status: "可生成",
              imageCount: Math.max(product.imageCount, imageCount),
              updatedAt: "刚刚",
            }
          : product,
      ),
      tasks: [saved.task, ...current.tasks],
    }));
    notify("任务已保存到共享工作区");
    go("tasks");
  };

  const reviewTask = async (task: GenerationTask, approved: boolean, comment: string) => {
    try {
      const saved = await reviewWorkspaceTask(task.id, approved, comment);
      setWorkspace((current) => ({
        ...current,
        tasks: current.tasks.map((item) => item.id === saved.id ? saved : item),
      }));
      notify(approved ? "审核已通过并同步给团队" : "任务已驳回并同步给团队");
    } catch (error) {
      notify(error instanceof Error ? error.message : "审核状态更新失败");
    }
  };

  if (authLoading) return <div className="auth-loading"><span>✦</span><b>正在验证登录状态</b></div>;
  if (!currentUser) return <LoginPage onLogin={(user) => { setCurrentUser(user); setPage(user.mustChangePassword ? "settings" : "dashboard"); }} />;
  if (workspaceLoading) return <div className="auth-loading"><span>✦</span><b>正在同步共享工作区</b></div>;

  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobileNav ? "mobile-open" : ""}`}>
        <button className="mobile-close" onClick={() => setMobileNav(false)} aria-label="关闭导航">
          ×
        </button>
        <button className="brand" onClick={() => go("dashboard")}>
          <span className="brand-mark">
            <i />
            <i />
            <i />
          </span>
          <span>
            <b>花彩</b>
            <small>AMAZON STUDIO</small>
          </span>
        </button>

        <nav>
          <p>生产工作区</p>
          {navItems.slice(0, 8).filter((item) => canAccessPage(currentUser.role, item.key)).map((item) => (
            <button
              key={item.key}
              className={page === item.key ? "active" : ""}
              onClick={() => go(item.key)}
            >
              <span>{item.icon}</span>
              {item.label}
              {item.key === "reviews" && pendingReviewCount > 0 && <em>{pendingReviewCount}</em>}
            </button>
          ))}
          <p>资产与管理</p>
          {navItems.slice(8).filter((item) => canAccessPage(currentUser.role, item.key)).map((item) => (
            <button
              key={item.key}
              className={page === item.key ? "active" : ""}
              onClick={() => go(item.key)}
            >
              <span>{item.icon}</span>
              {item.label}
            </button>
          ))}
        </nav>

        <div className="workspace-card">
          <span>{workspaceSummary.activeImageJobs ? `${workspaceSummary.activeImageJobs} 个任务生成中` : workspaceSummary.statisticsScope === "team" ? "TEAM WORKSPACE" : "MY OUTPUT"}</span>
          <b>美国站生产空间</b>
          <small>{workspaceSummary.statisticsScope === "team" ? "团队" : "我"}本月生图 {workspaceSummary.generatedThisMonth} 张 · Listing {workspaceSummary.listingsGeneratedThisMonth} 条</small>
          <div><i style={{ width: `${Math.min(100, Math.round(workspaceSummary.generatedThisMonth / workspaceSummary.monthlyQuota * 100))}%` }} /></div>
        </div>
        <div className="account-area" onClick={(event) => event.stopPropagation()}>
          {accountOpen && (
            <div className="account-menu">
              <div className="account-menu-profile">
                <span>{currentUser.name.slice(0, 1)}</span>
                <div><b>{currentUser.name}</b><small>@{currentUser.username}</small></div>
              </div>
              <div className="account-menu-role"><span>{currentUser.department}</span><b>{currentUser.role}</b></div>
              <button type="button" onClick={() => { setAccountOpen(false); go("settings"); }}><span>⚙</span>账号与权限<i>→</i></button>
              <button type="button" className="danger" onClick={() => { setAccountOpen(false); setLogoutConfirm(true); }}><span>↪</span>退出登录</button>
            </div>
          )}
          <button ref={accountTriggerRef} className="user-chip" onClick={() => setAccountOpen((open) => !open)} aria-expanded={accountOpen} aria-haspopup="menu">
            <span>{currentUser.name.slice(0, 1)}</span>
            <div><b>{currentUser.name}</b><small>{currentUser.department} · {currentUser.role}</small></div>
            <i>{accountOpen ? "⌃" : "⌄"}</i>
          </button>
        </div>
      </aside>

      <main>
        <header className="topbar">
          <button className="mobile-menu" onClick={() => setMobileNav(true)}>☰</button>
          <div>
            <span>花彩工作区</span>
            <i>/</i>
            <b>{titles[page].title}</b>
          </div>
          <div className="top-actions">
            <button className="icon-button" title="帮助" aria-label="打开帮助中心" onClick={() => setHelpOpen(true)}>?</button>
            <div className="notification-area" onClick={(event) => event.stopPropagation()}>
              <button className="icon-button notification-button" title="通知" onClick={() => setNotificationOpen((open) => !open)}>
                ◇
                {unreadNotificationCount > 0 && <em>{Math.min(99, unreadNotificationCount)}</em>}
              </button>
              {notificationOpen && (
                <div className="notification-popover">
                  <div className="notification-head">
                    <div><span className="eyebrow">NOTIFICATIONS</span><b>工作通知</b></div>
                    {unreadNotificationCount > 0 && <button onClick={readAllNotifications}>全部已读</button>}
                  </div>
                  <div className="notification-list">
                    {notifications.length ? notifications.map((notification) => (
                      <button className={notification.readAt ? "" : "unread"} key={notification.id} onClick={() => void openNotification(notification)}>
                        <i>{notificationIcon(notification)}</i>
                        <span>
                          <b>{notification.title}</b>
                          <small>{notification.message}</small>
                          {notificationMetaLine(notification) && <small className="notification-meta">{notificationMetaLine(notification)}</small>}
                          <time>{new Date(notification.createdAt).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })} · {notificationActionLabel(notification)}</time>
                        </span>
                      </button>
                    )) : <div className="notification-empty">暂时没有新通知</div>}
                  </div>
                </div>
              )}
            </div>
            {canAccessPage(currentUser.role, "create") && (
              <button className="primary-button" onClick={() => go("create")}>
                新建任务 <span>↗</span>
              </button>
            )}
          </div>
        </header>

        <section className="page">
          <div className="page-heading">
            <div>
              <span className="eyebrow">HUACAI COMMERCE OPS</span>
              <h1>{titles[page].title}</h1>
              <p>{titles[page].sub}</p>
            </div>
          </div>

          {page === "dashboard" && (
            <Dashboard products={workspace.products} tasks={workspace.tasks} go={go} role={currentUser.role} />
          )}
          {page === "products" && canAccessPage(currentUser.role, "products") && (
            <Products
              products={workspace.products}
              tasks={workspace.tasks}
              addProduct={addProduct}
              updateProduct={updateProduct}
              importProducts={importProducts}
              removeProduct={removeProduct}
              startTask={startTaskForProduct}
            />
          )}
          {page === "create" && (
            <CreateTask
              products={workspace.products}
              initialProductId={createProductId}
              createProduct={persistNewProduct}
              updateProduct={updateProduct}
              addTask={addTask}
              notify={notify}
              currentUser={currentUser}
            />
          )}
          {page === "tasks" && (
            <Tasks
              tasks={workspace.tasks}
              currentUser={currentUser}
              notify={notify}
              focusTaskId={notificationTargetId}
              onFocusHandled={() => setNotificationTargetId("")}
              goToListings={continueTaskToListing}
              onTaskUpdated={(saved) => setWorkspace((current) => ({
                ...current,
                tasks: current.tasks.map((item) => item.id === saved.id ? saved : item),
              }))}
            />
          )}
          {page === "reviews" && canAccessPage(currentUser.role, "reviews") && (
            <Reviews
              tasks={workspace.tasks}
              currentUser={currentUser}
              focusTaskId={notificationTargetId}
              onFocusHandled={() => setNotificationTargetId("")}
              onReview={reviewTask}
            />
          )}
          {page === "performance" && currentUser.role === "管理员" && <PerformancePage />}
          {page === "listings" && canAccessPage(currentUser.role, "listings") && (
            <ListingsPage
              products={workspace.products}
              tasks={workspace.tasks}
              notify={notify}
              focusSku={listingFocusSku}
              onFocusHandled={() => setListingFocusSku("")}
            />
          )}
          {page === "listingHistory" && canAccessPage(currentUser.role, "listingHistory") && (
            <ListingHistoryPage currentUser={currentUser} notify={notify} onOpenListing={(sku) => { setListingFocusSku(sku); go("listings"); }} />
          )}
          {page === "assets" && canAccessPage(currentUser.role, "assets") && (
            <AssetsPage notify={notify} currentUser={currentUser} onOpenHistory={() => go("assetHistory")} />
          )}
          {page === "assetHistory" && canAccessPage(currentUser.role, "assetHistory") && (
            <GeneratedHistoryPage currentUser={currentUser} notify={notify} onReusePrompt={reuseGeneratedPrompt} />
          )}
          {page === "settings" && <SettingsPage currentUser={currentUser} notify={notify} onUserUpdated={setCurrentUser} />}
        </section>
      </main>
      {logoutConfirm && (
        <LogoutDialog
          currentUser={currentUser}
          activeImageJobs={workspaceSummary.activeImageJobs}
          signingOut={signingOut}
          returnFocusRef={accountTriggerRef}
          onCancel={() => setLogoutConfirm(false)}
          onConfirm={signOut}
        />
      )}
      {helpOpen && (
        <HelpCenterDialog
          role={currentUser.role}
          onClose={() => setHelpOpen(false)}
          onNavigate={(target) => {
            setHelpOpen(false);
            go(target);
          }}
        />
      )}
      {toast && <div className="toast" role="status" aria-live="polite">✓ {toast}</div>}
    </div>
  );
}

function Dashboard({
  products,
  tasks,
  go,
  role,
}: {
  products: Product[];
  tasks: GenerationTask[];
  go: (page: PageKey) => void;
  role: EmployeeAccount["role"];
}) {
  const [myStatistics, setMyStatistics] = useState<PersonalStatistics | null>(null);
  const hasProducts = products.length > 0;
  const hasTasks = tasks.length > 0;
  const hasApprovedTask = tasks.some((task) => task.status === "已通过");
  const hasPendingReview = tasks.some((task) => task.status === "待审核");
  const canManageProducts = canAccessPage(role, "products");
  const canCreateTask = canAccessPage(role, "create");
  const stats = [
    { label: "SKU 总数", value: products.length, delta: "当前商品库", tone: "violet" },
    { label: "生成中", value: tasks.filter((task) => task.status === "生成中").length, delta: "当前任务", tone: "lime" },
    { label: "待审核", value: tasks.filter((task) => task.status === "待审核").length, delta: "等待处理", tone: "orange" },
    { label: "已通过", value: tasks.filter((task) => task.status === "已通过").length, delta: "当前记录", tone: "blue" },
  ];
  const quickItems = [
    ["01", "Amazon 六图套图", "生成完整 Listing 图片结构", "create"],
    ["02", "Amazon 白底主图", "纯白背景与合规检查", "create"],
    ["03", "批量导入 SKU", "使用 Excel 建立商品资料", "products"],
    ["04", "处理待审核任务", "检查结果并通过或驳回", "reviews"],
  ].filter((item) => canAccessPage(role, item[3] as PageKey));

  useEffect(() => {
    if (role === "管理员") return;
    let cancelled = false;
    getMyStatistics(30).then((result) => {
      if (!cancelled) setMyStatistics(result);
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [role]);

  return (
    <>
      <section className="hero">
        <div>
          <span className="hero-kicker"><i /> {hasProducts ? "Amazon Listing 视觉工作流" : "首次使用 · 公司工作区初始化"}</span>
          <h2>{hasProducts ? <>从商品原图到<br /><em>合规六图套图。</em></> : <>先把公司商品<br /><em>带进花彩。</em></>}</h2>
          <p>{hasProducts ? "让商品资料、图片生成、合规检查与人工审核在一个工作台流转；AI 生图服务接入后自动执行。" : canManageProducts ? "导入 Excel/CSV 或新建真实 SKU，随后即可上传商品原图、派发设计任务并进入审核流程。" : "工作区正在初始化。运营或管理员导入公司 SKU 后，你的任务会出现在这里。"}</p>
          <div className="hero-actions">
            {!hasProducts && canManageProducts && <button className="primary-button large" onClick={() => go("products")}>导入 / 新建公司 SKU <span>→</span></button>}
            {hasProducts && canAccessPage(role, "create") && <button className="primary-button large" onClick={() => go("create")}>创建六图任务 <span>→</span></button>}
            {hasPendingReview && !canAccessPage(role, "create") && canAccessPage(role, "reviews") && <button className="primary-button large" onClick={() => go("reviews")}>处理待审核任务 <span>→</span></button>}
            {hasProducts && canManageProducts && <button className="secondary-button" onClick={() => go("products")}>查看 SKU 商品库</button>}
            {!hasProducts && role === "管理员" && <button className="secondary-button" onClick={() => go("settings")}>配置员工账号</button>}
          </div>
        </div>
        <div className="hero-visual">
          <span className="visual-badge top">多品类商品</span>
          <span className="visual-badge right">电商履约示意</span>
          <div className="product-stage">
            <img className="hero-product-image" src={ecommerceHeroImage} alt="电商商品、包装箱与家居用品组合" />
          </div>
          <small>ECOMMERCE CATALOG · PRODUCT OPS</small>
        </div>
      </section>

      {role !== "管理员" && (
        <section className="panel personal-output-panel">
          <div className="panel-head"><div><span className="eyebrow">MY OUTPUT · LAST 30 DAYS</span><h3>我的产出</h3></div><small>只显示你自己的数据</small></div>
          <div className="personal-output-grid">
            <article><small>AI 生图</small><strong>{myStatistics?.imagesGenerated ?? "—"}</strong><span>成功生成张数</span></article>
            <article><small>AI Listing</small><strong>{myStatistics?.listingsGenerated ?? "—"}</strong><span>成功生成版本</span></article>
            <article><small>创建任务</small><strong>{myStatistics?.tasksCreated ?? "—"}</strong><span>系统真实记录</span></article>
            <article><small>完成审核</small><strong>{myStatistics?.reviewsCompleted ?? "—"}</strong><span>通过与驳回</span></article>
          </div>
        </section>
      )}

      {(!hasProducts || !hasTasks || !hasApprovedTask) && (
        <section className="panel onboarding-panel">
          <div className="onboarding-head">
            <div><span className="eyebrow">GETTING STARTED</span><h3>把真实工作流跑通</h3></div>
            <span>{[hasProducts, hasTasks, hasApprovedTask].filter(Boolean).length} / 3 已完成</span>
          </div>
          <div className="onboarding-steps">
            <article className={hasProducts ? "done" : "current"}>
              <i>{hasProducts ? "✓" : "1"}</i>
              <div><b>导入公司 SKU</b><small>维护真实商品、品牌、类目和站点资料。</small></div>
              {!hasProducts && canManageProducts && <button onClick={() => go("products")}>去导入 →</button>}
            </article>
            <article className={hasTasks ? "done" : hasProducts ? "current" : ""}>
              <i>{hasTasks ? "✓" : "2"}</i>
              <div><b>建立首个视觉任务</b><small>上传商品原图，选择任务类型并分配负责人。</small></div>
              {!hasTasks && hasProducts && canCreateTask && <button onClick={() => go("create")}>去创建 →</button>}
            </article>
            <article className={hasApprovedTask ? "done" : hasTasks ? "current" : ""}>
              <i>{hasApprovedTask ? "✓" : "3"}</i>
              <div><b>完成首次审核</b><small>设计提交作品，审核通过后形成可追踪记录。</small></div>
              {!hasApprovedTask && hasTasks && canAccessPage(role, "reviews") && <button onClick={() => go("reviews")}>去审核 →</button>}
            </article>
          </div>
        </section>
      )}

      <div className="stat-grid">
        {stats.map((stat) => (
          <article className={`stat-card ${stat.tone}`} key={stat.label}>
            <span>{stat.label}</span>
            <strong>{String(stat.value).padStart(2, "0")}</strong>
            <small>{stat.delta}</small>
          </article>
        ))}
      </div>

      <section className="split-grid">
        <div className="panel">
          <div className="panel-head">
            <div><span className="eyebrow">ACTIVE TASKS</span><h3>最近任务</h3></div>
            <button onClick={() => go("tasks")}>查看全部 →</button>
          </div>
          <TaskTable tasks={tasks.slice(0, 3)} compact onOpen={() => go("tasks")} />
        </div>
        <div className="panel quick-start">
          <div className="panel-head"><div><span className="eyebrow">QUICK START</span><h3>开始一个任务</h3></div></div>
          {quickItems.map((item) => (
            <button key={item[0]} onClick={() => go(item[3] as PageKey)}>
              <span>{item[0]}</span><div><b>{item[1]}</b><small>{item[2]}</small></div><i>↗</i>
            </button>
          ))}
        </div>
      </section>
    </>
  );
}

function Products({
  products,
  tasks,
  addProduct,
  updateProduct,
  importProducts,
  removeProduct,
  startTask,
}: {
  products: Product[];
  tasks: GenerationTask[];
  addProduct: (product: Product) => void;
  updateProduct: (product: Product) => void;
  importProducts: (products: Product[]) => Promise<number>;
  removeProduct: (product: Product) => Promise<boolean>;
  startTask: (productId: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [deleteCandidate, setDeleteCandidate] = useState<Product | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [listings, setListings] = useState<AmazonListing[]>([]);

  useEffect(() => {
    if (!openMenuId) return;
    const closeMenu = () => setOpenMenuId(null);
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeMenu();
    };
    window.addEventListener("click", closeMenu);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("click", closeMenu);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [openMenuId]);

  useEffect(() => {
    let cancelled = false;
    getListings()
      .then((items) => {
        if (!cancelled) setListings(items);
      })
      .catch(() => {
        if (!cancelled) setListings([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = useMemo(
    () => products.filter((product) =>
      `${product.sku}${product.name}${product.brand}`.toLowerCase().includes(query.toLowerCase()),
    ),
    [products, query],
  );

  return (
    <div className="panel">
      <div className="toolbar">
        <label className="search"><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索 SKU、商品名或品牌" /></label>
        <div>
          <button className="secondary-button" onClick={() => setShowImport(true)}>⇧ Excel / CSV 导入</button>
          <button className="primary-button" onClick={() => setShowForm(true)}>＋ 新建 SKU</button>
        </div>
      </div>
      <div className="product-table">
        <div className="table-row table-header">
          <span>商品</span><span>站点 / 类目</span><span>素材</span><span>状态</span><span>最后更新</span><span />
        </div>
        {filtered.map((product) => {
          const readiness = evaluateProductReadiness(product);
          return (
          <div className="table-row" key={product.id}>
            <span className="product-cell"><i>{product.name.slice(0, 1)}</i><span><b>{product.name}</b><small>{product.sku} · {product.brand}{product.asin ? ` · ${product.asin}` : ""}</small><ProductReadinessBadge readiness={readiness} /></span></span>
            <span><b>{product.marketplace}</b><small>{product.category}</small></span>
            <span className={product.imageCount ? "" : "muted-warning"}>{product.imageCount ? `${product.imageCount} 张原图` : "待上传原图"}</span>
            <span><Status value={product.status} /></span>
            <span>{product.updatedAt}</span>
            <span className="product-actions">
              <button
                className="more-button"
                type="button"
                aria-label={`操作 ${product.sku}`}
                aria-expanded={openMenuId === product.id}
                onClick={(event) => {
                  event.stopPropagation();
                  setOpenMenuId((current) => current === product.id ? null : product.id);
                }}
              >•••</button>
              {openMenuId === product.id && (
                <span className="product-menu" role="menu" onClick={(event) => event.stopPropagation()}>
                  <button type="button" role="menuitem" onClick={() => { setEditing(product); setOpenMenuId(null); }}>编辑商品</button>
                  <button type="button" role="menuitem" onClick={() => startTask(product.id)}>创建生成任务</button>
                  <button
                    type="button"
                    role="menuitem"
                    className="danger"
                    onClick={() => {
                      setOpenMenuId(null);
                      setDeleteCandidate(product);
                    }}
                  >删除商品</button>
                </span>
              )}
            </span>
          </div>
          );
        })}
        {!filtered.length && (
          <div className="product-list-empty">
            <span>{products.length ? "⌕" : "◇"}</span>
            <div><b>{products.length ? "没有匹配的 SKU" : "公司商品库还是空的"}</b><small>{products.length ? "请调整搜索关键词。" : "点击右上角新建 SKU，或使用 Excel / CSV 批量导入公司商品。"}</small></div>
          </div>
        )}
      </div>
      {showForm && <ProductModal close={() => setShowForm(false)} submit={(product) => { addProduct(product); setShowForm(false); }} />}
      {editing && <ProductModal product={editing} close={() => setEditing(null)} submit={(product) => { updateProduct(product); setEditing(null); }} />}
      {showImport && (
        <ProductImportDialog
          existingSkus={products.map((product) => product.sku)}
          onClose={() => setShowImport(false)}
          onImport={importProducts}
        />
      )}
      {deleteCandidate && (
        <ProductDeleteDialog
          product={deleteCandidate}
          relatedTaskCount={tasks.filter((task) => task.productId === deleteCandidate.id).length}
          relatedListingCount={listings.filter((listing) => listing.sku.toLowerCase() === deleteCandidate.sku.toLowerCase()).length}
          deleting={deleting}
          onCancel={() => !deleting && setDeleteCandidate(null)}
          onConfirm={async () => {
            setDeleting(true);
            try {
              if (await removeProduct(deleteCandidate)) setDeleteCandidate(null);
            } finally {
              setDeleting(false);
            }
          }}
        />
      )}
    </div>
  );
}

function ProductModal({ product, close, submit }: { product?: Product; close: () => void; submit: (product: Product) => void }) {
  const [form, setForm] = useState({
    sku: product?.sku ?? "",
    asin: product?.asin ?? "",
    name: product?.name ?? "",
    brand: product?.brand ?? "",
    category: product?.category ?? "Home & Kitchen",
    marketplace: product?.marketplace ?? "美国站" as Marketplace,
  });

  const save = (event: React.FormEvent) => {
    event.preventDefault();
    submit({
      id: product?.id ?? `prd-${Date.now()}`,
      ...form,
      status: product?.status ?? "资料待完善",
      imageCount: product?.imageCount ?? 0,
      updatedAt: "刚刚",
    });
  };

  return (
    <div className="modal-backdrop" onMouseDown={close}>
      <form className="modal" onSubmit={save} onMouseDown={(event) => event.stopPropagation()}>
        <div className="modal-head"><div><span className="eyebrow">{product ? "EDIT PRODUCT" : "NEW PRODUCT"}</span><h3>{product ? "编辑 SKU 商品" : "新建 SKU 商品"}</h3></div><button type="button" onClick={close}>×</button></div>
        <div className="form-grid">
          <label>SKU<input required value={form.sku} onChange={(event) => setForm({ ...form, sku: event.target.value })} placeholder="例如 HC-CUP-001" /></label>
          <label>ASIN（可选）<input maxLength={10} pattern="[A-Za-z0-9]{10}" title="ASIN 应为 10 位字母或数字" value={form.asin} onChange={(event) => setForm({ ...form, asin: event.target.value.toUpperCase() })} placeholder="例如 B0ABC12345" /></label>
        </div>
        <label>商品名称<input required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="请输入中文商品名称" /></label>
        <div className="form-grid">
          <label>品牌<input required value={form.brand} onChange={(event) => setForm({ ...form, brand: event.target.value })} /></label>
          <label>目标站点<select value={form.marketplace} onChange={(event) => setForm({ ...form, marketplace: event.target.value as Marketplace })}><option>美国站</option><option>英国站</option><option>德国站</option><option>日本站</option></select></label>
        </div>
        <label>Amazon 类目<input value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })} /></label>
        <div className="modal-actions"><button type="button" className="secondary-button" onClick={close}>取消</button><button className="primary-button">{product ? "保存修改" : "保存商品"}</button></div>
      </form>
    </div>
  );
}

function ProductReadinessBadge({ readiness }: { readiness: ProductReadiness }) {
  return (
    <span className={`product-readiness-badge ${readiness.tone}`}>
      资料完整度 {readiness.score}% · {readiness.label}
    </span>
  );
}

function CreateTask({
  products,
  initialProductId,
  template,
  createProduct,
  updateProduct,
  addTask,
  notify,
  currentUser,
}: {
  products: Product[];
  initialProductId?: string;
  template?: InspirationTemplate;
  createProduct: (product: Product) => Promise<Product | undefined>;
  updateProduct: (product: Product) => Promise<Product | undefined>;
  addTask: (task: GenerationTask, imageCount?: number) => Promise<void>;
  notify: (message: string) => void;
  currentUser: EmployeeAccount;
}) {
  const [productId, setProductId] = useState(
    products.some((product) => product.id === initialProductId) ? initialProductId! : products[0]?.id ?? "",
  );
  const [taskType, setTaskType] = useState<GenerationTask["type"]>(
    template?.type === "白底图" ? "Amazon 白底主图" : template?.type === "场景图" ? "场景图" : "Amazon 六图套图",
  );
  const [team, setTeam] = useState<Array<Pick<EmployeeAccount, "id" | "name" | "department" | "role">>>([]);
  const [assigneeId, setAssigneeId] = useState(currentUser.role === "设计" ? currentUser.id : "");
  const [dueDate, setDueDate] = useState(() => {
    const date = new Date(Date.now() + 3 * 86400000);
    return date.toISOString().slice(0, 10);
  });
  const [images, setImages] = useState<Array<{ file: File; url: string }>>([]);
  const [dragging, setDragging] = useState(false);
  const [saving, setSaving] = useState(false);
  const [productEditor, setProductEditor] = useState<"new" | Product | null>(null);

  useEffect(() => {
    getTeamDirectory()
      .then((members) => {
        setTeam(members);
        if (!assigneeId) {
          const firstDesigner = members.find((member) => member.role === "设计");
          if (firstDesigner) setAssigneeId(firstDesigner.id);
        }
      })
      .catch(() => notify("团队成员列表读取失败，任务将保存为待分配"));
  }, []);
  const selected = products.find((product) => product.id === productId);
  const canManageProducts = currentUser.role === "管理员" || currentUser.role === "运营";
  const expectedInputCount = expectedTaskInputCount(taskType);
  const inputCreationMessage = taskInputCreationMessage(taskType, images.length);
  const selectedReadiness = selected
    ? evaluateProductReadiness(selected, {
        referenceImageCount: images.length,
        minReferenceImages: expectedInputCount,
      })
    : null;

  const addImages = (incoming: FileList | File[]) => {
    const candidates = Array.from(incoming);
    const accepted: Array<{ file: File; url: string }> = [];
    const duplicateKeys = new Set(images.map(({ file }) => `${file.name}-${file.size}-${file.lastModified}`));
    const remainingSlots = Math.max(0, 10 - images.length);

    for (const file of candidates) {
      if (accepted.length >= remainingSlots) break;
      if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
        notify(`${file.name} 不是支持的图片格式`);
        continue;
      }
      if (file.size > 20 * 1024 * 1024) {
        notify(`${file.name} 超过 20MB`);
        continue;
      }
      const key = `${file.name}-${file.size}-${file.lastModified}`;
      if (duplicateKeys.has(key)) continue;
      duplicateKeys.add(key);
      accepted.push({ file, url: URL.createObjectURL(file) });
    }

    if (accepted.length) {
      setImages((current) => [...current, ...accepted]);
      notify(`已添加 ${accepted.length} 张商品图`);
    }
  };

  const removeImage = (index: number) => {
    setImages((current) => {
      URL.revokeObjectURL(current[index].url);
      return current.filter((_, imageIndex) => imageIndex !== index);
    });
  };

  const create = async () => {
    if (!selected || !images.length || saving) return;
    const inputMessage = taskInputCreationMessage(taskType, images.length);
    if (!inputMessage.ready) {
      notify(inputMessage.description);
      return;
    }
    setSaving(true);
    const taskId = `TSK-${Date.now().toString().slice(-8)}`;
    let uploadedAssetIds: string[] = [];
    try {
      const assets = await uploadTaskImages(taskId, selected.id, images.map(({ file }) => file), "input");
      uploadedAssetIds = assets.map((asset) => asset.id);
      await addTask({
        id: taskId,
        productId: selected.id,
        sku: selected.sku,
        productName: selected.name,
        type: taskType,
        status: "待生成",
        progress: 0,
        owner: currentUser.name,
        assignedToId: assigneeId || undefined,
        assignedToName: team.find((member) => member.id === assigneeId)?.name ?? "待分配",
        dueAt: dueDate ? new Date(`${dueDate}T18:00:00`).toISOString() : undefined,
        updatedAt: "刚刚",
        inputAssetIds: assets.map((asset) => asset.id),
        inputCount: images.length,
        templateId: template?.id,
        templateTitle: template?.title,
        templatePrompt: template?.prompt,
      }, images.length);
      images.forEach((image) => URL.revokeObjectURL(image.url));
    } catch (error) {
      if (uploadedAssetIds.length) await deleteAssets(uploadedAssetIds);
      notify(error instanceof Error ? error.message : "图片上传失败，请稍后重试");
      setSaving(false);
    }
  };

  return (
    <section className="create-layout">
      <div className="panel form-panel">
        {template && (
          <div className="applied-template">
            <span>✦</span>
            <div><b>已应用模板：{template.title}</b><p>{template.prompt}</p></div>
          </div>
        )}
        <div className="step-title"><span>01</span><div><h3>选择商品</h3><p>生成参数将继承商品和品牌资料。</p></div></div>
        <div className="product-picker">
          {products.length ? (
            <label className="input-label">SKU 商品
              <select value={productId} onChange={(event) => setProductId(event.target.value)}>
                {products.map((product) => <option key={product.id} value={product.id}>{product.sku} · {product.name}</option>)}
              </select>
            </label>
          ) : (
            <div className="product-picker-empty">
              <b>公司商品库还是空的</b>
              <span>{canManageProducts ? "先添加真实 SKU，再创建图片任务。" : "请联系运营或管理员添加公司 SKU。"}</span>
            </div>
          )}
          {canManageProducts && (
            <div className="product-picker-actions">
              <button type="button" className="secondary-button" disabled={!selected} onClick={() => selected && setProductEditor(selected)}>编辑当前商品</button>
              <button type="button" className="primary-button" onClick={() => setProductEditor("new")}>＋ 新增 SKU</button>
            </div>
          )}
        </div>
        {selected && (
          <div className="selected-product-meta">
            <span><b>品牌</b>{selected.brand}</span>
            <span><b>类目</b>{selected.category}</span>
            <span><b>站点</b>{selected.marketplace}</span>
            {selected.asin && <span><b>ASIN</b>{selected.asin}</span>}
          </div>
        )}
        {selectedReadiness && selectedReadiness.issues.length > 0 && (
          <div className={`product-readiness-alert ${selectedReadiness.tone}`}>
            <div>
              <b>商品资料完整度 {selectedReadiness.score}% · {selectedReadiness.label}</b>
              <p>这些不一定阻止创建任务，但提前补齐能减少运营、美工、审核之间来回确认。</p>
              <ul>
                {selectedReadiness.issues.slice(0, 3).map((issue) => (
                  <li key={issue.key}><strong>{issue.label}</strong><span>{issue.detail}</span></li>
                ))}
              </ul>
            </div>
            {canManageProducts && (
              <button type="button" className="secondary-button" onClick={() => selected && setProductEditor(selected)}>
                补商品资料
              </button>
            )}
          </div>
        )}
        <div className="task-assignment">
          <label className="input-label">负责人
            <select value={assigneeId} onChange={(event) => setAssigneeId(event.target.value)}>
              <option value="">待分配</option>
              {team.filter((member) => member.role === "设计" || member.role === "管理员").map((member) => (
                <option key={member.id} value={member.id}>{member.name} · {member.department}</option>
              ))}
            </select>
          </label>
          <label className="input-label">截止日期
            <input type="date" min={new Date().toISOString().slice(0, 10)} value={dueDate} onChange={(event) => setDueDate(event.target.value)} />
          </label>
        </div>
        <div className="step-title"><span>02</span><div><h3>选择任务类型</h3><p>当前会保存为待生成任务；接入 AI 服务后自动进入生成队列。</p></div></div>
        <div className="task-options">
          {(["Amazon 六图套图", "Amazon 白底主图", "场景图"] as const).map((type) => (
            <button className={taskType === type ? "selected" : ""} onClick={() => setTaskType(type)} key={type}>
              <span>{type === "Amazon 六图套图" ? "▦" : type === "Amazon 白底主图" ? "◇" : "◉"}</span>
              <div><b>{type}</b><small>{type === "Amazon 六图套图" ? "主图、角度、卖点、尺寸、场景与细节" : type === "Amazon 白底主图" ? "纯白背景、主体占比与基础合规检查" : "将商品自然融入使用场景"}</small></div>
            </button>
          ))}
        </div>
        <div className="step-title"><span>03</span><div><h3>商品原图</h3><p>{taskType} 至少需要 {expectedInputCount} 张参考原图；支持 JPG、PNG、WEBP，单张不超过 20MB。</p></div></div>
        <label
          className={`upload-box ${dragging ? "dragging" : ""} ${images.length ? "has-images" : ""}`}
          onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            addImages(event.dataTransfer.files);
          }}
        >
          <input
            type="file"
            multiple
            accept="image/jpeg,image/png,image/webp"
            onChange={(event) => {
              if (event.target.files) addImages(event.target.files);
              event.target.value = "";
            }}
          />
          <span>＋</span><b>{images.length ? "继续添加商品图片" : "点击或拖入商品图片"}</b>
          <small>支持 JPG、PNG、WEBP，单张不超过 20MB，最多 10 张</small>
        </label>
        {images.length > 0 && (
          <div className="upload-results">
            <div className="upload-results-head">
              <b>已添加 {images.length} 张</b>
              <small>第一张将作为主参考图</small>
            </div>
            <div className="upload-thumbnails">
              {images.map((image, index) => (
                <article key={`${image.file.name}-${image.file.lastModified}`}>
                  <img src={image.url} alt={image.file.name} />
                  {index === 0 && <span>主参考图</span>}
                  <button type="button" onClick={() => removeImage(index)} aria-label={`删除 ${image.file.name}`}>×</button>
                  <small title={image.file.name}>{image.file.name}</small>
                </article>
              ))}
            </div>
          </div>
        )}
        <div className={`task-output-requirement ${inputCreationMessage.ready ? "ready" : ""}`}>
          <b>{inputCreationMessage.ready ? "✓" : "!"} {inputCreationMessage.title}</b>
          <small>{inputCreationMessage.description}</small>
        </div>
        <button className="primary-button submit-task" disabled={!selected || !inputCreationMessage.ready || saving} onClick={create}>
          {saving ? "正在上传原图…" : images.length ? `保存待生成任务 · ${images.length} 张原图` : "请先添加商品图片"} <span>→</span>
        </button>
      </div>
      <aside className="panel product-summary">
        <span className="eyebrow">TASK PREVIEW</span><h3>任务预览</h3>
        <div className={`preview-art ${images.length ? "with-image" : ""}`}>
          <span>AMAZON</span>
          {images.length ? <img src={images[0].url} alt="商品主参考图预览" /> : <b>{selected?.name.slice(0, 1) ?? "?"}</b>}
          <small>2000 × 2000</small>
        </div>
        <dl>
          <div><dt>SKU</dt><dd>{selected?.sku ?? "—"}</dd></div>
          <div><dt>ASIN</dt><dd>{selected?.asin ?? "未填写"}</dd></div>
          <div><dt>资料完整度</dt><dd>{selectedReadiness ? `${selectedReadiness.score}%` : "—"}</dd></div>
          <div><dt>目标站点</dt><dd>{selected?.marketplace ?? "—"}</dd></div>
          <div><dt>任务类型</dt><dd>{taskType}</dd></div>
          <div><dt>负责人</dt><dd>{team.find((member) => member.id === assigneeId)?.name ?? "待分配"}</dd></div>
          <div><dt>截止日期</dt><dd>{dueDate || "未设置"}</dd></div>
          <div><dt>预计输出</dt><dd>{taskType === "Amazon 六图套图" ? "6 张" : "1 张"}</dd></div>
          <div><dt>商品原图</dt><dd>{images.length ? `${images.length} / ${expectedInputCount} 张` : `未添加 / 需 ${expectedInputCount} 张`}</dd></div>
        </dl>
        <div className="compliance-note"><b>✓ Amazon 合规检查</b><p>生成完成后将检查背景、主体占比、尺寸、文字与水印。</p></div>
      </aside>
      {productEditor && (
        <ProductModal
          product={productEditor === "new" ? undefined : productEditor}
          close={() => setProductEditor(null)}
          submit={async (product) => {
            const saved = productEditor === "new"
              ? await createProduct(product)
              : await updateProduct(product);
            if (!saved) return;
            setProductId(saved.id);
            setProductEditor(null);
          }}
        />
      )}
    </section>
  );
}

function isTaskOverdue(task: GenerationTask) {
  return isWorkflowTaskOverdue(task);
}

function formatTaskDueDate(dueAt?: string) {
  return dueAt ? new Date(dueAt).toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" }) : "未设置";
}

function Tasks({
  tasks,
  currentUser,
  notify,
  focusTaskId,
  onFocusHandled,
  goToListings,
  onTaskUpdated,
}: {
  tasks: GenerationTask[];
  currentUser: EmployeeAccount;
  notify: (message: string) => void;
  focusTaskId?: string;
  onFocusHandled?: () => void;
  goToListings: (task: GenerationTask) => void;
  onTaskUpdated: (task: GenerationTask) => void;
}) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"全部" | TaskStatus>("全部");
  const [selected, setSelected] = useState<GenerationTask | null>(null);
  const [outputFiles, setOutputFiles] = useState<File[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [team, setTeam] = useState<Array<Pick<EmployeeAccount, "id" | "name" | "department" | "role">>>([]);
  const [assignmentId, setAssignmentId] = useState("");
  const [assignmentDueDate, setAssignmentDueDate] = useState("");
  const [savingAssignment, setSavingAssignment] = useState(false);
  const filtered = tasks.filter((task) => {
    const matchesQuery = `${task.id}${task.sku}${task.productName}`.toLowerCase().includes(query.toLowerCase());
    return matchesQuery && (status === "全部" || task.status === status);
  });

  useEffect(() => {
    if (currentUser.role !== "管理员" && currentUser.role !== "运营") return;
    getTeamDirectory().then(setTeam).catch(() => undefined);
  }, [currentUser.role]);

  const openTask = (task: GenerationTask) => {
    setSelected(task);
    setAssignmentId(task.assignedToId ?? "");
    setAssignmentDueDate(task.dueAt ? task.dueAt.slice(0, 10) : "");
  };

  const closeSelected = () => {
    if (submitting) return;
    setSelected(null);
    setOutputFiles([]);
  };

  useEffect(() => {
    if (!focusTaskId) return;
    const task = tasks.find((item) => item.id === focusTaskId);
    if (task) {
      openTask(task);
    } else {
      notify("通知对应的任务不存在或已被删除");
    }
    onFocusHandled?.();
  }, [focusTaskId, tasks]);

  const submitOutputs = async () => {
    if (!selected || !outputFiles.length || submitting) return;
    const outputMessage = taskOutputSubmissionMessage(selected.type, outputFiles.length);
    if (!outputMessage.ready) {
      notify(outputMessage.description);
      return;
    }
    setSubmitting(true);
    let uploadedAssetIds: string[] = [];
    try {
      const uploaded = await uploadTaskImages(selected.id, selected.productId, outputFiles, "output");
      uploadedAssetIds = uploaded.map((asset) => asset.id);
      const saved = await submitWorkspaceTaskOutputs(selected.id, uploadedAssetIds);
      onTaskUpdated(saved);
      setSelected(saved);
      setOutputFiles([]);
      notify(`已提交第 ${saved.version ?? 1} 版成品，等待审核`);
    } catch (error) {
      if (uploadedAssetIds.length) await deleteAssets(uploadedAssetIds);
      notify(error instanceof Error ? error.message : "成品提交失败");
    } finally {
      setSubmitting(false);
    }
  };

  const saveAssignment = async () => {
    if (!selected || savingAssignment) return;
    setSavingAssignment(true);
    try {
      const saved = await updateWorkspaceTaskAssignment(selected.id, {
        assignedToId: assignmentId || undefined,
        dueAt: assignmentDueDate ? new Date(`${assignmentDueDate}T18:00:00`).toISOString() : undefined,
      });
      onTaskUpdated(saved);
      setSelected(saved);
      notify("负责人和截止时间已更新");
    } catch (error) {
      notify(error instanceof Error ? error.message : "任务安排更新失败");
    } finally {
      setSavingAssignment(false);
    }
  };

  const selectedStage = selected ? taskWorkflowStage(selected) : null;
  const selectedAction = selected ? nextTaskAction(selected, currentUser) : null;
  const selectedListingHandoff = selected ? listingHandoffForTask(selected, currentUser) : null;
  const selectedExpectedOutputCount = selected ? expectedTaskOutputCount(selected.type) : 0;
  const selectedOutputMessage = selected ? taskOutputSubmissionMessage(selected.type, outputFiles.length) : null;

  return (
    <div className="panel">
      <div className="toolbar">
        <label className="search"><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索任务编号、SKU 或商品名" /></label>
        <select className="secondary-button" value={status} onChange={(event) => setStatus(event.target.value as "全部" | TaskStatus)}>
          <option>全部</option><option>草稿</option><option>待生成</option><option>生成中</option><option>待审核</option><option>已驳回</option><option>已通过</option>
        </select>
      </div>
      {filtered.length ? <TaskTable tasks={filtered} currentUser={currentUser} onOpen={openTask} /> : <EmptyState title="没有匹配的任务" description="请调整搜索词或状态筛选。" />}
      {selected && (
        <div className="modal-backdrop" onMouseDown={closeSelected}>
          <section className="modal task-detail" role="dialog" aria-modal="true" aria-labelledby="task-detail-title" onMouseDown={(event) => event.stopPropagation()}>
            <div className="modal-head"><div><span className="eyebrow">TASK DETAILS</span><h3 id="task-detail-title">{selected.productName}</h3></div><button aria-label="关闭任务详情" onClick={closeSelected}>×</button></div>
            <dl>
              <div><dt>任务编号</dt><dd>{selected.id}</dd></div>
              <div><dt>SKU</dt><dd>{selected.sku}</dd></div>
              <div><dt>任务类型</dt><dd>{selected.type}</dd></div>
              <div><dt>负责人</dt><dd>{selected.assignedToName || selected.owner}</dd></div>
              <div><dt>创建人</dt><dd>{selected.createdByName || "—"}</dd></div>
              <div><dt>截止时间</dt><dd className={isTaskOverdue(selected) ? "overdue-text" : ""}>{formatTaskDueDate(selected.dueAt)}{isTaskOverdue(selected) ? " · 已逾期" : ""}</dd></div>
              <div><dt>状态</dt><dd><Status value={selected.status} /></dd></div>
              <div><dt>原图数量</dt><dd>{selected.inputCount ?? 0} 张</dd></div>
              <div><dt>成品版本</dt><dd>{selected.version ? `V${selected.version}` : "尚未提交"}</dd></div>
              <div><dt>成品数量</dt><dd>{selected.outputCount ?? 0} 张</dd></div>
              <div><dt>最后更新</dt><dd>{selected.updatedAt}</dd></div>
            </dl>
            {selectedStage && selectedAction && (
              <div className={`task-next-action ${selectedAction.tone}`}>
                <span>{selectedStage.step}</span>
                <div>
                  <b>{selectedAction.title}</b>
                  <p>{selectedAction.description}</p>
                  <small>当前阶段：{selectedStage.title} · {selectedStage.description}</small>
                </div>
              </div>
            )}
            {(currentUser.role === "管理员" || currentUser.role === "运营") && selected.status !== "已通过" && (
              <div className="task-assignment-editor">
                <div><b>任务调度</b><p>更换负责人或调整交付日期，新负责人会收到站内通知。</p></div>
                <label>负责人
                  <select value={assignmentId} onChange={(event) => setAssignmentId(event.target.value)}>
                    <option value="">待分配</option>
                    {team.filter((member) => member.role === "设计" || member.role === "管理员").map((member) => (
                      <option value={member.id} key={member.id}>{member.name} · {member.department}</option>
                    ))}
                  </select>
                </label>
                <label>截止日期
                  <input type="date" min={new Date().toISOString().slice(0, 10)} value={assignmentDueDate} onChange={(event) => setAssignmentDueDate(event.target.value)} />
                </label>
                <button className="secondary-button" disabled={savingAssignment} onClick={saveAssignment}>{savingAssignment ? "保存中…" : "更新安排"}</button>
              </div>
            )}
            {selected.reviewComment && (
              <div className={`task-review-result ${selected.status === "已驳回" ? "rejected" : ""}`}>
                <b>{selected.status === "已驳回" ? "需要修改" : "审核意见"}</b>
                <p>{selected.reviewComment}</p>
                <small>{selected.reviewedBy} · {selected.reviewedAt ? new Date(selected.reviewedAt).toLocaleString("zh-CN") : "刚刚"}</small>
              </div>
            )}
            {selected.reviewHistory?.length ? (
              <div className="task-version-history">
                <b>版本记录</b>
                {[...selected.reviewHistory].reverse().map((review, index) => (
                  <div key={`${review.reviewedAt}-${index}`}>
                    <span>V{review.version} · {review.approved ? "通过" : "驳回"}</span>
                    <p>{review.comment}</p>
                  </div>
                ))}
              </div>
            ) : null}
            {selectedListingHandoff && (
              <div className={`task-listing-handoff ${selectedListingHandoff.tone}`}>
                <span>A</span>
                <div>
                  <b>{selectedListingHandoff.title}</b>
                  <p>{selectedListingHandoff.description}</p>
                </div>
                {selectedListingHandoff.cta && (
                  <button
                    type="button"
                    className="primary-button"
                    onClick={() => {
                      closeSelected();
                      goToListings(selected);
                    }}
                  >
                    {selectedListingHandoff.cta} <span>↗</span>
                  </button>
                )}
              </div>
            )}
            {(currentUser.role === "管理员" || currentUser.role === "设计")
              && selected.status !== "待审核"
              && selected.status !== "已通过" && (
              <div className="task-submit-output">
                <div><b>{selected.status === "已驳回" ? "上传修改后的成品" : "提交成品审核"}</b><p>支持 JPG、PNG、WEBP；{selected.type} 至少 {selectedExpectedOutputCount} 张，最多 10 张。提交后自动进入审核中心。</p></div>
                <label>
                  <input type="file" multiple accept="image/jpeg,image/png,image/webp" onChange={(event) => {
                    const files = [...(event.target.files ?? [])]
                      .filter((file) => ["image/jpeg", "image/png", "image/webp"].includes(file.type))
                      .slice(0, 10);
                    setOutputFiles(files);
                    event.currentTarget.value = "";
                  }} />
                  <span>{outputFiles.length ? `已选择 ${outputFiles.length} 张成品` : "选择成品图片"}</span>
                </label>
                {selectedOutputMessage && (
                  <div className={`task-output-requirement ${selectedOutputMessage.ready ? "ready" : ""}`}>
                    <b>{selectedOutputMessage.ready ? "✓" : "!"} {selectedOutputMessage.title}</b>
                    <small>{selectedOutputMessage.description}</small>
                  </div>
                )}
                <button className="primary-button" disabled={!selectedOutputMessage?.ready || submitting} onClick={submitOutputs}>
                  {submitting ? "正在提交…" : selected.status === "已驳回" ? "提交新版本" : "提交审核"} →
                </button>
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

function TaskTable({
  tasks,
  compact = false,
  onOpen,
  currentUser,
}: {
  tasks: GenerationTask[];
  compact?: boolean;
  onOpen?: (task: GenerationTask) => void;
  currentUser?: Pick<EmployeeAccount, "id" | "role">;
}) {
  if (!tasks.length) {
    return (
      <div className={`task-table-empty ${compact ? "compact" : ""}`}>
        <span>▤</span>
        <div><b>还没有生产任务</b><small>导入公司 SKU 后即可创建第一条视觉任务。</small></div>
      </div>
    );
  }
  return (
    <div className={`task-table ${compact ? "compact" : ""}`}>
      {tasks.map((task) => (
        <TaskTableRow task={task} compact={compact} currentUser={currentUser} onOpen={onOpen} key={task.id} />
      ))}
    </div>
  );
}

function TaskTableRow({
  task,
  compact,
  currentUser,
  onOpen,
}: {
  task: GenerationTask;
  compact: boolean;
  currentUser?: Pick<EmployeeAccount, "id" | "role">;
  onOpen?: (task: GenerationTask) => void;
}) {
  const action = currentUser ? nextTaskAction(task, currentUser) : null;
  return (
    <div className="task-row">
      <span className="task-icon">{task.type.includes("六图") ? "▦" : task.type.includes("白底") ? "◇" : "◉"}</span>
      <span><b>{task.productName}</b><small>{task.id} · {task.sku}</small></span>
      {!compact && <span><b>{task.type}</b><small>负责人：{task.assignedToName || task.owner} · 截止 {formatTaskDueDate(task.dueAt)}</small></span>}
      <span><Status value={task.status} />{task.status === "生成中" && <div className="progress"><i style={{ width: `${task.progress}%` }} /></div>}</span>
      {action && !compact && <span className={`task-row-action ${action.tone}`}>{action.title}</span>}
      <span className={`task-time ${isTaskOverdue(task) ? "overdue-text" : ""}`}>{isTaskOverdue(task) ? "已逾期" : task.updatedAt}</span>
      <button onClick={() => onOpen?.(task)} aria-label={`查看任务 ${task.id}`}>→</button>
    </div>
  );
}

function ReviewPreview({ task }: { task: GenerationTask }) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    let active = true;
    let createdUrl = "";
    const assetId = task.outputAssetIds?.[0];
    if (!assetId) {
      setUrl("");
      return;
    }
    getAssetObjectUrl(assetId)
      .then((objectUrl) => {
        createdUrl = objectUrl;
        if (active) setUrl(objectUrl);
        else URL.revokeObjectURL(objectUrl);
      })
      .catch(() => setUrl(""));
    return () => {
      active = false;
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };
  }, [task.id, task.version, task.outputAssetIds?.[0]]);
  return (
    <div className="review-image">
      <span>V{task.version ?? 1} · 待审核</span>
      {url ? <img src={url} alt={`${task.productName} 待审核成品`} /> : <b>{task.productName.slice(0, 1)}</b>}
      {(task.outputCount ?? 0) > 1 && <small>共 {task.outputCount} 张</small>}
    </div>
  );
}

function Reviews({
  tasks,
  currentUser,
  focusTaskId,
  onFocusHandled,
  onReview,
}: {
  tasks: GenerationTask[];
  currentUser: EmployeeAccount;
  focusTaskId?: string;
  onFocusHandled?: () => void;
  onReview: (task: GenerationTask, approved: boolean, comment: string) => Promise<void>;
}) {
  const pending = tasks.filter((task) => task.status === "待审核");
  const [comments, setComments] = useState<Record<string, string>>({});
  const [reviewingId, setReviewingId] = useState("");
  const [highlightedId, setHighlightedId] = useState("");
  useEffect(() => {
    if (!focusTaskId) return;
    const task = pending.find((item) => item.id === focusTaskId);
    if (task) {
      setHighlightedId(task.id);
      window.requestAnimationFrame(() => document.getElementById(`review-task-${task.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" }));
      window.setTimeout(() => setHighlightedId(""), 2600);
    }
    onFocusHandled?.();
  }, [focusTaskId, tasks]);
  const submitReview = async (task: GenerationTask, approved: boolean) => {
    const comment = comments[task.id]?.trim() ?? "";
    if (!approved && !comment) return;
    setReviewingId(task.id);
    try {
      await onReview(task, approved, comment);
      setComments((current) => {
        const next = { ...current };
        delete next[task.id];
        return next;
      });
    } finally {
      setReviewingId("");
    }
  };
  return pending.length ? (
    <div className="review-grid">
      {pending.map((task) => (
        <ReviewCard
          key={task.id}
          task={task}
          currentUser={currentUser}
          highlighted={highlightedId === task.id}
          comment={comments[task.id] ?? ""}
          reviewing={reviewingId === task.id}
          onCommentChange={(comment) => setComments((current) => ({ ...current, [task.id]: comment }))}
          onSubmitReview={submitReview}
        />
      ))}
    </div>
  ) : <EmptyState title="当前没有待审核任务" description="图片生成完成并提交审核后，任务会出现在这里。" />;
}

function ReviewCard({
  task,
  currentUser,
  highlighted,
  comment,
  reviewing,
  onCommentChange,
  onSubmitReview,
}: {
  task: GenerationTask;
  currentUser: EmployeeAccount;
  highlighted: boolean;
  comment: string;
  reviewing: boolean;
  onCommentChange: (comment: string) => void;
  onSubmitReview: (task: GenerationTask, approved: boolean) => void;
}) {
  const action = nextTaskAction(task, currentUser);
  const reviewOutputCount = Math.max(task.outputCount ?? 0, task.outputAssetIds?.length ?? 0);
  const reviewOutputMessage = taskOutputSubmissionMessage(task.type, reviewOutputCount);
  const rejectionMessage = reviewRejectionCommentMessage(comment);
  return (
    <article id={`review-task-${task.id}`} className={`panel review-card ${highlighted ? "notification-focus" : ""}`}>
      <ReviewPreview task={task} />
      <div>
        <span className="eyebrow">{task.sku}</span>
        <h3>{task.productName}</h3>
        <p>{task.type} · {task.assignedToName || task.owner} 提交 · V{task.version ?? 1} · 截止 {formatTaskDueDate(task.dueAt)}</p>
        <div className={`review-next-action ${action.tone}`}>
          <b>{action.title}</b>
          <small>{action.description}</small>
        </div>
        {!reviewOutputMessage.ready && (
          <div className="task-output-requirement">
            <b>! 暂不能通过审核：{reviewOutputMessage.title}</b>
            <small>{reviewOutputMessage.description}</small>
          </div>
        )}
        <label className="review-comment">审核意见
          <textarea
            value={comment}
            onChange={(event) => onCommentChange(event.target.value)}
            maxLength={1000}
            placeholder="通过时可选填；驳回时请明确说明需要修改的位置和要求"
          />
        </label>
        {comment.trim() && (
          <div className={`review-comment-quality ${rejectionMessage.ready ? "ready" : ""}`}>
            <b>{rejectionMessage.ready ? "✓" : "!"} {rejectionMessage.title}</b>
            <small>{rejectionMessage.description}</small>
          </div>
        )}
        <div className="review-actions">
          <button className="secondary-button" disabled={reviewing || !rejectionMessage.ready} onClick={() => onSubmitReview(task, false)}>驳回修改</button>
          <button className="primary-button" disabled={reviewing || !reviewOutputMessage.ready} onClick={() => onSubmitReview(task, true)}>{reviewing ? "提交中…" : "通过审核"}</button>
        </div>
      </div>
    </article>
  );
}

function Placeholder({ kind }: { kind: "assets" | "settings" }) {
  if (kind === "assets") {
    return (
      <div className="asset-grid">
        {["商品原图", "已生成作品", "品牌 Logo", "参考图"].map((name, index) => (
          <article className="panel asset-card" key={name}><span>{["◇", "✦", "Aa", "▧"][index]}</span><div><b>{name}</b><small>{[12, 36, 4, 8][index]} 项资产</small></div><i>→</i></article>
        ))}
      </div>
    );
  }
  return (
    <div className="settings-grid">
      {[
        ["团队与权限", "管理成员、部门和角色权限"],
        ["品牌规范", "品牌色、字体、Logo 和禁用内容"],
        ["生成策略", "默认模型、图片尺寸和质量策略"],
        ["用量与成本", "部门额度、模型调用和成本统计"],
      ].map((item) => <article className="panel setting-card" key={item[0]}><span>⚙</span><div><h3>{item[0]}</h3><p>{item[1]}</p></div><button>配置 →</button></article>)}
    </div>
  );
}

function EmptyState({ title, description }: { title: string; description: string }) {
  return <div className="panel empty"><span>✓</span><h3>{title}</h3><p>{description}</p></div>;
}

function Status({ value }: { value: Product["status"] | GenerationTask["status"] }) {
  return <span className={`status status-${value}`}>{value}</span>;
}

export default App;
