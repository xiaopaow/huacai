import { useEffect, useMemo, useState } from "react";
import { initialProducts, initialTasks } from "./data/mock";
import {
  bootstrapWorkspace,
  createWorkspaceProduct,
  createWorkspaceTask,
  deleteAssets,
  deleteWorkspaceProduct,
  getAssetObjectUrl,
  getCurrentUser,
  getNotifications,
  getTeamDirectory,
  getWorkspace,
  getWorkspaceSummary,
  hasAuthToken,
  logout,
  markAllNotificationsRead,
  markNotificationRead,
  recordActivity,
  reviewWorkspaceTask,
  submitWorkspaceTaskOutputs,
  updateWorkspaceProduct,
  uploadTaskImages,
  type WorkspaceNotification,
} from "./lib/api";
import ListingsPage from "./pages/ListingsPage";
import LoginPage from "./pages/LoginPage";
import PerformancePage from "./pages/PerformancePage";
import SettingsPage from "./pages/SettingsPage";
import AssetsPage from "./pages/AssetsPage";
import type { InspirationTemplate } from "./data/templates";
import type {
  GenerationTask,
  EmployeeAccount,
  Marketplace,
  PageKey,
  Product,
  TaskStatus,
  WorkspaceState,
} from "./types/domain";

const storageKey = "huacai-amazon-workspace-v1";

const navItems: Array<{ key: PageKey; icon: string; label: string }> = [
  { key: "dashboard", icon: "⌂", label: "工作台" },
  { key: "products", icon: "◇", label: "SKU 商品库" },
  { key: "create", icon: "✦", label: "新建生成任务" },
  { key: "listings", icon: "A", label: "Listing 中心" },
  { key: "tasks", icon: "▤", label: "任务中心" },
  { key: "reviews", icon: "✓", label: "审核中心" },
  { key: "performance", icon: "↗", label: "员工效率" },
  { key: "assets", icon: "▧", label: "素材库" },
  { key: "settings", icon: "⚙", label: "系统设置" },
];

const titles: Record<PageKey, { title: string; sub: string }> = {
  dashboard: { title: "Amazon 视觉工作台", sub: "今天也让每个 SKU 更接近成交。" },
  products: { title: "SKU 商品库", sub: "统一维护商品资料、原图和站点信息。" },
  create: { title: "新建生成任务", sub: "从商品资料开始，生成完整 Amazon Listing 套图。" },
  listings: { title: "Amazon Listing 中心", sub: "编写、检查并准备提交多站点商品资料。" },
  tasks: { title: "任务中心", sub: "跟踪生成进度、失败任务与交付状态。" },
  reviews: { title: "审核中心", sub: "集中处理待审核图片和修改意见。" },
  performance: { title: "员工效率后台", sub: "基于真实操作记录查看团队产出与流程瓶颈。" },
  assets: { title: "素材库", sub: "管理品牌、商品原图和已交付视觉资产。" },
  settings: { title: "系统设置", sub: "管理团队、权限、品牌规范和模型策略。" },
};

function canAccessPage(role: EmployeeAccount["role"], page: PageKey) {
  if (role === "管理员") return true;
  const permissions: Record<Exclude<EmployeeAccount["role"], "管理员">, PageKey[]> = {
    "运营": ["dashboard", "products", "create", "listings", "tasks", "assets", "settings"],
    "设计": ["dashboard", "create", "tasks", "assets", "settings"],
    "审核": ["dashboard", "tasks", "reviews", "assets", "settings"],
  };
  return permissions[role].includes(page);
}

function loadWorkspace(): WorkspaceState {
  try {
    const saved = localStorage.getItem(storageKey);
    if (saved) return JSON.parse(saved) as WorkspaceState;
  } catch {
    // Storage may be unavailable in private browsing.
  }
  return { products: initialProducts, tasks: initialTasks };
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
    monthlyQuota: 500,
    activeImageJobs: 0,
  });
  const [createProductId, setCreateProductId] = useState<string>();
  const [accountOpen, setAccountOpen] = useState(false);
  const [logoutConfirm, setLogoutConfirm] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [notifications, setNotifications] = useState<WorkspaceNotification[]>([]);
  const [notificationOpen, setNotificationOpen] = useState(false);
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
        let shared = await getWorkspace();
        if (!shared.products.length && !shared.tasks.length && currentUser.role === "管理员") {
          try {
            shared = await bootstrapWorkspace(loadWorkspace());
          } catch {
            shared = await getWorkspace();
          }
        }
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
    setNotificationOpen(false);
    go(notification.type === "REVIEW_REQUESTED" ? "reviews" : "tasks");
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

  const addProduct = async (product: Product) => {
    try {
      const saved = await createWorkspaceProduct(product);
      setWorkspace((current) => ({
        ...current,
        products: [saved, ...current.products],
      }));
      void recordActivity({ type: "SKU_CREATED", entityType: "product", entityId: product.id });
      notify(`SKU ${product.sku} 已保存到共享工作区`);
      go("products");
    } catch (error) {
      notify(error instanceof Error ? error.message : "SKU 保存失败");
    }
  };

  const updateProduct = async (product: Product) => {
    try {
      const saved = await updateWorkspaceProduct(product);
      setWorkspace((current) => ({
        ...current,
        products: current.products.map((item) => item.id === saved.id ? saved : item),
      }));
      notify(`SKU ${product.sku} 已同步更新`);
    } catch (error) {
      notify(error instanceof Error ? error.message : "SKU 更新失败");
    }
  };

  const removeProduct = async (product: Product) => {
    if (workspace.tasks.some((task) => task.productId === product.id)) {
      notify("该商品已有生产任务，不能直接删除");
      return;
    }
    try {
      await deleteWorkspaceProduct(product.id);
      setWorkspace((current) => ({
        ...current,
        products: current.products.filter((item) => item.id !== product.id),
      }));
      notify(`SKU ${product.sku} 已删除`);
    } catch (error) {
      notify(error instanceof Error ? error.message : "SKU 删除失败");
    }
  };

  const startTaskForProduct = (productId: string) => {
    setCreateProductId(productId);
    go("create");
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
    void recordActivity({ type: "TASK_CREATED", entityType: "task", entityId: task.id });
    if (imageCount) {
      void recordActivity({ type: "IMAGE_UPLOADED", entityType: "asset", entityId: task.id, quantity: imageCount });
    }
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
          {navItems.slice(0, 7).filter((item) => canAccessPage(currentUser.role, item.key)).map((item) => (
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
          {navItems.slice(7).filter((item) => canAccessPage(currentUser.role, item.key)).map((item) => (
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
          <span>{workspaceSummary.activeImageJobs ? `${workspaceSummary.activeImageJobs} 个任务生成中` : "TEAM WORKSPACE"}</span>
          <b>美国站生产空间</b>
          <small>本月已生成 {workspaceSummary.generatedThisMonth} / {workspaceSummary.monthlyQuota} 张</small>
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
          <button className="user-chip" onClick={() => setAccountOpen((open) => !open)} aria-expanded={accountOpen}>
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
            <button className="icon-button" title="帮助">?</button>
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
                        <i>{notification.type === "TASK_ASSIGNED" ? "→" : notification.type === "REVIEW_REQUESTED" ? "✓" : notification.type === "TASK_APPROVED" ? "●" : "!"}</i>
                        <span><b>{notification.title}</b><small>{notification.message}</small><time>{new Date(notification.createdAt).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}</time></span>
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
            {page === "products" && (
              <button className="primary-button" onClick={() => go("create")}>＋ 添加商品</button>
            )}
          </div>

          {page === "dashboard" && (
            <Dashboard products={workspace.products} tasks={workspace.tasks} go={go} role={currentUser.role} />
          )}
          {page === "products" && canAccessPage(currentUser.role, "products") && (
            <Products
              products={workspace.products}
              addProduct={addProduct}
              updateProduct={updateProduct}
              removeProduct={removeProduct}
              startTask={startTaskForProduct}
            />
          )}
          {page === "create" && (
            <CreateTask
              products={workspace.products}
              initialProductId={createProductId}
              addProduct={addProduct}
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
              onTaskUpdated={(saved) => setWorkspace((current) => ({
                ...current,
                tasks: current.tasks.map((item) => item.id === saved.id ? saved : item),
              }))}
            />
          )}
          {page === "reviews" && canAccessPage(currentUser.role, "reviews") && <Reviews tasks={workspace.tasks} onReview={reviewTask} />}
          {page === "performance" && currentUser.role === "管理员" && <PerformancePage />}
          {page === "listings" && canAccessPage(currentUser.role, "listings") && <ListingsPage products={workspace.products} notify={notify} />}
          {page === "assets" && <AssetsPage notify={notify} currentUser={currentUser} />}
          {page === "settings" && <SettingsPage currentUser={currentUser} notify={notify} onUserUpdated={setCurrentUser} />}
        </section>
      </main>
      {logoutConfirm && (
        <div className="modal-backdrop" onMouseDown={() => !signingOut && setLogoutConfirm(false)}>
          <section className="modal logout-dialog" onMouseDown={(event) => event.stopPropagation()}>
            <div className="logout-icon">↪</div>
            <span className="eyebrow">SIGN OUT</span>
            <h3>确认退出花彩工作台？</h3>
            <p>退出后需要重新输入账号密码才能继续使用，当前未提交的表单内容可能会丢失。</p>
            <div className="modal-actions">
              <button className="secondary-button" disabled={signingOut} onClick={() => setLogoutConfirm(false)}>取消</button>
              <button className="danger-button" disabled={signingOut} onClick={signOut}>{signingOut ? "正在退出…" : "确认退出"}</button>
            </div>
          </section>
        </div>
      )}
      {toast && <div className="toast">✓ {toast}</div>}
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

  return (
    <>
      <section className="hero">
        <div>
          <span className="hero-kicker"><i /> Amazon Listing 视觉工作流</span>
          <h2>从商品原图到<br /><em>合规六图套图。</em></h2>
          <p>让商品资料、图片生成、合规检查与人工审核在一个工作台流转；AI 生图服务接入后自动执行。</p>
          <div className="hero-actions">
            {canAccessPage(role, "create") && <button className="primary-button large" onClick={() => go("create")}>创建六图任务 <span>→</span></button>}
            {!canAccessPage(role, "create") && canAccessPage(role, "reviews") && <button className="primary-button large" onClick={() => go("reviews")}>处理待审核任务 <span>→</span></button>}
            {canAccessPage(role, "products") && <button className="secondary-button" onClick={() => go("products")}>查看 SKU 商品库</button>}
          </div>
        </div>
        <div className="hero-visual">
          <span className="visual-badge top">主图示例</span>
          <span className="visual-badge right">白底规范示意</span>
          <div className="product-stage">
            <div className="headphone">
              <i />
              <span />
              <b />
            </div>
          </div>
          <small>AMAZON MAIN · 2000 × 2000</small>
        </div>
      </section>

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
  addProduct,
  updateProduct,
  removeProduct,
  startTask,
}: {
  products: Product[];
  addProduct: (product: Product) => void;
  updateProduct: (product: Product) => void;
  removeProduct: (product: Product) => void;
  startTask: (productId: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);

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
          <button className="secondary-button">⇧ Excel 导入</button>
          <button className="primary-button" onClick={() => setShowForm(true)}>＋ 新建 SKU</button>
        </div>
      </div>
      <div className="product-table">
        <div className="table-row table-header">
          <span>商品</span><span>站点 / 类目</span><span>素材</span><span>状态</span><span>最后更新</span><span />
        </div>
        {filtered.map((product) => (
          <div className="table-row" key={product.id}>
            <span className="product-cell"><i>{product.name.slice(0, 1)}</i><span><b>{product.name}</b><small>{product.sku} · {product.brand}</small></span></span>
            <span><b>{product.marketplace}</b><small>{product.category}</small></span>
            <span>{product.imageCount} 张原图</span>
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
                      if (window.confirm(`确定删除 SKU ${product.sku} 吗？`)) removeProduct(product);
                    }}
                  >删除商品</button>
                </span>
              )}
            </span>
          </div>
        ))}
      </div>
      {showForm && <ProductModal close={() => setShowForm(false)} submit={(product) => { addProduct(product); setShowForm(false); }} />}
      {editing && <ProductModal product={editing} close={() => setEditing(null)} submit={(product) => { updateProduct(product); setEditing(null); }} />}
    </div>
  );
}

function ProductModal({ product, close, submit }: { product?: Product; close: () => void; submit: (product: Product) => void }) {
  const [form, setForm] = useState({
    sku: product?.sku ?? "",
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
        <label>SKU<input required value={form.sku} onChange={(event) => setForm({ ...form, sku: event.target.value })} placeholder="例如 HC-CUP-001" /></label>
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

function CreateTask({
  products,
  initialProductId,
  template,
  addProduct,
  addTask,
  notify,
  currentUser,
}: {
  products: Product[];
  initialProductId?: string;
  template?: InspirationTemplate;
  addProduct: (product: Product) => void;
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
    setSaving(true);
    const taskId = `TSK-${Date.now().toString().slice(-8)}`;
    let uploadedAssetIds: string[] = [];
    try {
      const assets = await uploadTaskImages(taskId, selected.id, images.map(({ file }) => file));
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
        {products.length ? (
          <label className="input-label">SKU 商品
            <select value={productId} onChange={(event) => setProductId(event.target.value)}>
              {products.map((product) => <option key={product.id} value={product.id}>{product.sku} · {product.name}</option>)}
            </select>
          </label>
        ) : (
          <button onClick={() => addProduct({
            id: `prd-${Date.now()}`, sku: "DEMO-001", name: "示例商品", brand: "HUACAI",
            category: "Home & Kitchen", marketplace: "美国站", status: "资料待完善", imageCount: 0, updatedAt: "刚刚",
          })}>创建示例商品</button>
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
        <div className="step-title"><span>03</span><div><h3>商品原图</h3><p>支持 JPG、PNG、WEBP，单张不超过 20MB。</p></div></div>
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
        <button className="primary-button submit-task" disabled={!selected || !images.length || saving} onClick={create}>
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
          <div><dt>目标站点</dt><dd>{selected?.marketplace ?? "—"}</dd></div>
          <div><dt>任务类型</dt><dd>{taskType}</dd></div>
          <div><dt>负责人</dt><dd>{team.find((member) => member.id === assigneeId)?.name ?? "待分配"}</dd></div>
          <div><dt>截止日期</dt><dd>{dueDate || "未设置"}</dd></div>
          <div><dt>预计输出</dt><dd>{taskType === "Amazon 六图套图" ? "6 张" : "1 张"}</dd></div>
          <div><dt>商品原图</dt><dd>{images.length ? `${images.length} 张` : "未添加"}</dd></div>
        </dl>
        <div className="compliance-note"><b>✓ Amazon 合规检查</b><p>生成完成后将检查背景、主体占比、尺寸、文字与水印。</p></div>
      </aside>
    </section>
  );
}

function isTaskOverdue(task: GenerationTask) {
  return Boolean(
    task.dueAt
    && task.status !== "已通过"
    && new Date(task.dueAt).getTime() < Date.now(),
  );
}

function formatTaskDueDate(dueAt?: string) {
  return dueAt ? new Date(dueAt).toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" }) : "未设置";
}

function Tasks({
  tasks,
  currentUser,
  notify,
  onTaskUpdated,
}: {
  tasks: GenerationTask[];
  currentUser: EmployeeAccount;
  notify: (message: string) => void;
  onTaskUpdated: (task: GenerationTask) => void;
}) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"全部" | TaskStatus>("全部");
  const [selected, setSelected] = useState<GenerationTask | null>(null);
  const [outputFiles, setOutputFiles] = useState<File[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const filtered = tasks.filter((task) => {
    const matchesQuery = `${task.id}${task.sku}${task.productName}`.toLowerCase().includes(query.toLowerCase());
    return matchesQuery && (status === "全部" || task.status === status);
  });

  const closeSelected = () => {
    if (submitting) return;
    setSelected(null);
    setOutputFiles([]);
  };

  const submitOutputs = async () => {
    if (!selected || !outputFiles.length || submitting) return;
    setSubmitting(true);
    let uploadedAssetIds: string[] = [];
    try {
      const uploaded = await uploadTaskImages(selected.id, selected.productId, outputFiles);
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

  return (
    <div className="panel">
      <div className="toolbar">
        <label className="search"><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索任务编号、SKU 或商品名" /></label>
        <select className="secondary-button" value={status} onChange={(event) => setStatus(event.target.value as "全部" | TaskStatus)}>
          <option>全部</option><option>草稿</option><option>待生成</option><option>生成中</option><option>待审核</option><option>已驳回</option><option>已通过</option>
        </select>
      </div>
      {filtered.length ? <TaskTable tasks={filtered} onOpen={setSelected} /> : <EmptyState title="没有匹配的任务" description="请调整搜索词或状态筛选。" />}
      {selected && (
        <div className="modal-backdrop" onMouseDown={closeSelected}>
          <section className="modal task-detail" onMouseDown={(event) => event.stopPropagation()}>
            <div className="modal-head"><div><span className="eyebrow">TASK DETAILS</span><h3>{selected.productName}</h3></div><button onClick={closeSelected}>×</button></div>
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
            {(currentUser.role === "管理员" || currentUser.role === "设计")
              && selected.status !== "待审核"
              && selected.status !== "已通过" && (
              <div className="task-submit-output">
                <div><b>{selected.status === "已驳回" ? "上传修改后的成品" : "提交成品审核"}</b><p>支持 JPG、PNG、WEBP，最多 10 张。提交后自动进入审核中心。</p></div>
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
                <button className="primary-button" disabled={!outputFiles.length || submitting} onClick={submitOutputs}>
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
}: {
  tasks: GenerationTask[];
  compact?: boolean;
  onOpen?: (task: GenerationTask) => void;
}) {
  return (
    <div className={`task-table ${compact ? "compact" : ""}`}>
      {tasks.map((task) => (
        <div className="task-row" key={task.id}>
          <span className="task-icon">{task.type.includes("六图") ? "▦" : task.type.includes("白底") ? "◇" : "◉"}</span>
          <span><b>{task.productName}</b><small>{task.id} · {task.sku}</small></span>
          {!compact && <span><b>{task.type}</b><small>负责人：{task.assignedToName || task.owner} · 截止 {formatTaskDueDate(task.dueAt)}</small></span>}
          <span><Status value={task.status} />{task.status === "生成中" && <div className="progress"><i style={{ width: `${task.progress}%` }} /></div>}</span>
          <span className={`task-time ${isTaskOverdue(task) ? "overdue-text" : ""}`}>{isTaskOverdue(task) ? "已逾期" : task.updatedAt}</span>
          <button onClick={() => onOpen?.(task)} aria-label={`查看任务 ${task.id}`}>→</button>
        </div>
      ))}
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
  onReview,
}: {
  tasks: GenerationTask[];
  onReview: (task: GenerationTask, approved: boolean, comment: string) => Promise<void>;
}) {
  const pending = tasks.filter((task) => task.status === "待审核");
  const [comments, setComments] = useState<Record<string, string>>({});
  const [reviewingId, setReviewingId] = useState("");
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
        <article className="panel review-card" key={task.id}>
          <ReviewPreview task={task} />
          <div>
            <span className="eyebrow">{task.sku}</span>
            <h3>{task.productName}</h3>
            <p>{task.type} · {task.assignedToName || task.owner} 提交 · V{task.version ?? 1} · 截止 {formatTaskDueDate(task.dueAt)}</p>
            <label className="review-comment">审核意见
              <textarea
                value={comments[task.id] ?? ""}
                onChange={(event) => setComments((current) => ({ ...current, [task.id]: event.target.value }))}
                maxLength={1000}
                placeholder="通过时可选填；驳回时请明确说明需要修改的位置和要求"
              />
            </label>
            <div className="review-actions">
              <button className="secondary-button" disabled={reviewingId === task.id || !(comments[task.id]?.trim())} onClick={() => void submitReview(task, false)}>驳回修改</button>
              <button className="primary-button" disabled={reviewingId === task.id} onClick={() => void submitReview(task, true)}>{reviewingId === task.id ? "提交中…" : "通过审核"}</button>
            </div>
          </div>
        </article>
      ))}
    </div>
  ) : <EmptyState title="当前没有待审核任务" description="图片生成完成并提交审核后，任务会出现在这里。" />;
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
