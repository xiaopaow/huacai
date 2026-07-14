import fs from "node:fs/promises";
import path from "node:path";

const width = 3600;
const height = 2200;
const nodes = [];
const edges = [];

const esc = (value) => String(value)
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;");

const point = (x, y) => ({ x, y });

function line(a, b, options = {}) {
  const {
    cardA = "",
    cardB = "",
    dashed = false,
    color = "#6677A8",
    width: strokeWidth = 3,
  } = options;
  edges.push(`<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="${color}" stroke-width="${strokeWidth}"${dashed ? ' stroke-dasharray="10 9"' : ""}/>`);
  const label = (text, ratio) => {
    if (!text) return "";
    const x = a.x + (b.x - a.x) * ratio;
    const y = a.y + (b.y - a.y) * ratio - 12;
    return `<text class="cardinality" x="${x}" y="${y}">${esc(text)}</text>`;
  };
  edges.push(label(cardA, 0.17), label(cardB, 0.83));
}

function entity(id, x, y, label, options = {}) {
  const { w = 250, h = 92, role = false, external = false, subtitle = "" } = options;
  const cls = role ? "entity role" : external ? "entity external" : "entity";
  nodes.push(`
    <g id="${id}" class="${cls}">
      <rect x="${x - w / 2}" y="${y - h / 2}" width="${w}" height="${h}" rx="18"/>
      <text class="entity-title" x="${x}" y="${y + (subtitle ? -6 : 8)}">${esc(label)}</text>
      ${subtitle ? `<text class="entity-subtitle" x="${x}" y="${y + 23}">${esc(subtitle)}</text>` : ""}
    </g>`);
  return { id, x, y, w, h };
}

function relation(id, x, y, label, options = {}) {
  const { w = 190, h = 112, step = "" } = options;
  const points = `${x},${y - h / 2} ${x + w / 2},${y} ${x},${y + h / 2} ${x - w / 2},${y}`;
  nodes.push(`
    <g id="${id}" class="relation">
      <polygon points="${points}"/>
      ${step ? `<text class="relation-step" x="${x}" y="${y - 10}">${esc(step)}</text>` : ""}
      <text class="relation-title" x="${x}" y="${y + (step ? 17 : 7)}">${esc(label)}</text>
    </g>`);
  return { id, x, y, w, h };
}

function attribute(id, x, y, label, owner, options = {}) {
  const { w = Math.max(150, label.length * 25 + 54), h = 68, key = false, multi = false } = options;
  line(owner, point(x, y), { color: "#94A1C7", width: 2 });
  nodes.push(`
    <g id="${id}" class="attribute${multi ? " multi" : ""}">
      <ellipse cx="${x}" cy="${y}" rx="${w / 2}" ry="${h / 2}"/>
      ${multi ? `<ellipse cx="${x}" cy="${y}" rx="${w / 2 - 7}" ry="${h / 2 - 7}"/>` : ""}
      <text class="attribute-title${key ? " key" : ""}" x="${x}" y="${y + 7}">${esc(label)}</text>
    </g>`);
  return { id, x, y, w, h };
}

function note(x, y, title, lines, options = {}) {
  const { w = 520, accent = "#7158E8" } = options;
  const h = 68 + lines.length * 30;
  nodes.push(`
    <g class="note">
      <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="18"/>
      <rect x="${x}" y="${y}" width="8" height="${h}" rx="4" fill="${accent}"/>
      <text class="note-title" x="${x + 28}" y="${y + 35}">${esc(title)}</text>
      ${lines.map((item, index) => `<text class="note-line" x="${x + 28}" y="${y + 70 + index * 30}">${esc(item)}</text>`).join("")}
    </g>`);
}

// Role actors
const admin = entity("admin", 340, 130, "管理员", { role: true, subtitle: "账号 · 权限 · 统计 · 备份" });
const operator = entity("operator", 1120, 130, "运营", { role: true, subtitle: "SKU · 派单 · Listing" });
const designer = entity("designer", 1900, 130, "设计", { role: true, subtitle: "制作 · AI · 版本提交" });
const reviewer = entity("reviewer", 2680, 130, "审核", { role: true, subtitle: "检查 · 通过 · 驳回" });

// Identity and governance
const employee = entity("employee", 340, 480, "员工账号", { subtitle: "Employee" });
const session = entity("session", 760, 480, "登录会话", { w: 220, subtitle: "AuthSession" });
const manageAccount = relation("manage-account", 340, 300, "管理账号");
const login = relation("login", 555, 480, "登录");
line(admin, manageAccount, { cardA: "1", cardB: "N" });
line(manageAccount, employee, { cardA: "1", cardB: "N" });
line(employee, login, { cardA: "1", cardB: "N" });
line(login, session, { cardA: "1", cardB: "N" });

attribute("employee-name", 95, 415, "姓名", employee);
attribute("employee-dept", 100, 520, "部门", employee);
attribute("employee-role", 340, 610, "角色", employee);
attribute("employee-active", 575, 610, "启用状态", employee);
attribute("session-expire", 770, 610, "过期时间", session);

// Main business entities
const product = entity("product", 520, 980, "SKU 商品", { w: 270, subtitle: "Product" });
const task = entity("task", 1260, 980, "视觉生产任务", { w: 300, subtitle: "Task" });
const review = entity("review", 1990, 980, "审核记录", { w: 270, subtitle: "ReviewRecord" });
const listing = entity("listing", 2700, 980, "Amazon Listing", { w: 320, subtitle: "Listing" });
const store = entity("store", 3340, 980, "Amazon 店铺", { w: 280, external: true, subtitle: "Seller Central / SP-API" });

const maintain = relation("maintain", 790, 600, "维护商品", { step: "①" });
const assign = relation("assign", 1260, 590, "创建 / 派单", { step: "②" });
const execute = relation("execute", 1660, 590, "执行 / 提交", { step: "③" });
const audit = relation("audit", 2290, 590, "审核版本", { step: "④" });
line(operator, maintain, { cardA: "M", cardB: "N" });
line(maintain, product, { cardA: "M", cardB: "N" });
line(operator, assign, { cardA: "1", cardB: "N" });
line(admin, assign, { cardA: "1", cardB: "N", dashed: true });
line(assign, task, { cardA: "1", cardB: "N" });
line(designer, execute, { cardA: "1", cardB: "N" });
line(execute, task, { cardA: "1", cardB: "N" });
line(reviewer, audit, { cardA: "1", cardB: "N" });
line(admin, audit, { cardA: "1", cardB: "N", dashed: true });
line(audit, review, { cardA: "1", cardB: "N" });

const produceTask = relation("produce-task", 885, 980, "发起生产", { step: "⑤" });
const produceReview = relation("produce-review", 1625, 980, "版本审核", { step: "⑥" });
const deliver = relation("deliver", 2350, 980, "通过后交付", { step: "⑦" });
const publish = relation("publish", 3035, 980, "提交发布", { step: "⑧" });
line(product, produceTask, { cardA: "1", cardB: "N" });
line(produceTask, task, { cardA: "1", cardB: "N" });
line(task, produceReview, { cardA: "1", cardB: "N" });
line(produceReview, review, { cardA: "1", cardB: "N" });
line(review, deliver, { cardA: "M", cardB: "N" });
line(deliver, listing, { cardA: "M", cardB: "N" });
line(listing, publish, { cardA: "N", cardB: "1" });
line(publish, store, { cardA: "N", cardB: "1" });

// Product attributes
attribute("product-sku", 310, 805, "SKU（唯一）", product, { key: true });
attribute("product-asin", 510, 785, "ASIN", product);
attribute("product-name", 705, 805, "商品名称", product);
attribute("product-brand", 250, 930, "品牌", product);
attribute("product-category", 250, 1045, "Amazon 类目", product);
attribute("product-market", 510, 1145, "目标站点", product);
attribute("product-status", 730, 1115, "商品状态", product);

// Task attributes
attribute("task-id", 1050, 805, "任务编号", task, { key: true });
attribute("task-type", 1245, 785, "任务类型", task);
attribute("task-assignee", 1450, 805, "负责人", task);
attribute("task-due", 1050, 1115, "截止时间", task);
attribute("task-status", 1250, 1160, "任务状态", task);
attribute("task-version", 1465, 1115, "成品版本", task);

// Review attributes
attribute("review-version", 1780, 805, "审核版本", review);
attribute("review-result", 1980, 785, "通过 / 驳回", review);
attribute("review-comment", 2200, 805, "审核意见", review);
attribute("reviewer-name", 1800, 1115, "审核人", review);
attribute("review-time", 2020, 1160, "审核时间", review);

// Listing attributes
attribute("listing-id", 2490, 805, "Listing 编号", listing, { key: true });
attribute("listing-sku", 2690, 785, "SKU", listing);
attribute("listing-pt", 2915, 805, "Product Type", listing);
attribute("listing-site", 2470, 1115, "Marketplace ID", listing);
attribute("listing-price", 2680, 1160, "价格 / 币种", listing);
attribute("listing-stock", 2900, 1115, "库存", listing);
attribute("listing-status", 3040, 1070, "发布状态", listing);

// Amazon store attributes
attribute("store-seller", 3290, 805, "Seller ID", store);
attribute("store-auth", 3490, 805, "授权状态", store);
attribute("store-mode", 3440, 1130, "沙盒 / 正式", store);

// Assets and AI
const asset = entity("asset", 1260, 1560, "图片素材", { w: 280, subtitle: "Uploaded / Generated Asset" });
const aiJob = entity("ai-job", 630, 1560, "AI 生图任务", { w: 270, subtitle: "ImageJob" });
const useAsset = relation("use-asset", 1260, 1305, "使用素材");
const aiGenerate = relation("ai-generate", 930, 1560, "生成");
const designerUpload = relation("designer-upload", 1680, 1330, "上传 / 生成");
line(task, useAsset, { cardA: "M", cardB: "N" });
line(useAsset, asset, { cardA: "M", cardB: "N" });
line(aiJob, aiGenerate, { cardA: "1", cardB: "0..1" });
line(aiGenerate, asset, { cardA: "1", cardB: "0..1" });
line(designer, designerUpload, { cardA: "1", cardB: "N", dashed: true });
line(designerUpload, asset, { cardA: "1", cardB: "N" });

attribute("asset-id", 1090, 1430, "素材编号", asset, { key: true });
attribute("asset-purpose", 1430, 1430, "input / output / reference", asset);
attribute("asset-owner", 1080, 1685, "所有人", asset);
attribute("asset-file", 1440, 1685, "文件类型 / 大小", asset);
attribute("ai-model", 430, 1450, "模型", aiJob);
attribute("ai-prompt", 630, 1410, "提示词", aiJob);
attribute("ai-progress", 830, 1450, "进度 / 重试次数", aiJob);
attribute("ai-status", 630, 1700, "queued / running / success / failed", aiJob);

// Listing schemas and templates
const template = entity("template", 2450, 1560, "Amazon 类目模板", { w: 310, subtitle: "XLSM / XLSX" });
const ptd = entity("ptd", 3030, 1560, "官方 PTD 规则", { w: 290, external: true, subtitle: "Product Type Definition" });
const applyTemplate = relation("apply-template", 2580, 1305, "应用模板");
const matchPtd = relation("match-ptd", 2910, 1305, "匹配规则");
line(listing, applyTemplate, { cardA: "N", cardB: "1" });
line(applyTemplate, template, { cardA: "N", cardB: "1" });
line(listing, matchPtd, { cardA: "N", cardB: "1" });
line(matchPtd, ptd, { cardA: "N", cardB: "1" });
attribute("template-fields", 2280, 1715, "类目字段", template, { multi: true });
attribute("template-required", 2600, 1750, "必填 / 条件必填", template);
attribute("ptd-version", 2920, 1715, "Schema 版本", ptd);
attribute("ptd-enum", 3200, 1715, "枚举 / 校验规则", ptd, { multi: true });

// Notifications, audit events and backups
const notification = entity("notification", 1850, 1960, "站内通知", { w: 250, subtitle: "Notification" });
const activity = entity("activity", 900, 1960, "操作记录", { w: 250, subtitle: "ActivityEvent" });
const backup = entity("backup", 340, 1960, "备份快照", { w: 250, subtitle: "DB + Images" });
const triggerNotice = relation("trigger-notice", 1600, 1775, "触发通知");
const receiveNotice = relation("receive-notice", 1190, 1840, "接收");
const recordAction = relation("record-action", 660, 1780, "记录操作");
const maintainBackup = relation("maintain-backup", 340, 1780, "备份 / 恢复");
line(task, triggerNotice, { cardA: "1", cardB: "N", dashed: true });
line(review, triggerNotice, { cardA: "1", cardB: "N", dashed: true });
line(triggerNotice, notification, { cardA: "1", cardB: "N" });
line(employee, receiveNotice, { cardA: "1", cardB: "N", dashed: true });
line(receiveNotice, notification, { cardA: "1", cardB: "N" });
line(employee, recordAction, { cardA: "1", cardB: "N", dashed: true });
line(recordAction, activity, { cardA: "1", cardB: "N" });
line(admin, maintainBackup, { cardA: "1", cardB: "N", dashed: true });
line(maintainBackup, backup, { cardA: "1", cardB: "N" });
line(admin, activity, { cardA: "1", cardB: "N", dashed: true });

attribute("notice-type", 1710, 2070, "通知类型", notification);
attribute("notice-read", 1990, 2070, "已读时间", notification);
attribute("activity-type", 780, 2080, "操作类型", activity);
attribute("activity-entity", 1030, 2080, "业务对象", activity);
attribute("backup-time", 180, 2080, "创建时间", backup);
attribute("backup-assets", 500, 2080, "包含图片", backup);

note(2740, 1870, "图例与实现说明", [
  "矩形 = 实体；菱形 = 业务关系；椭圆 = 关键属性",
  "1 / N / M = 关系基数；虚线 = 管理、通知或审计旁路",
  "Listing 当前通过 SKU 逻辑关联商品，后续建议增加 productId",
  "图片二进制存储在 data/uploads，数据库保存元数据和归属",
], { w: 800, accent: "#D99B19" });

const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
      <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#E9ECF4" stroke-width="1"/>
    </pattern>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="8" stdDeviation="9" flood-color="#26345F" flood-opacity="0.12"/>
    </filter>
    <style>
      text { font-family: "Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", sans-serif; text-anchor: middle; }
      .title { font-size: 38px; font-weight: 800; fill: #202943; text-anchor: start; }
      .subtitle { font-size: 18px; fill: #707A98; text-anchor: start; }
      .section-label { font-size: 18px; font-weight: 800; fill: #66719B; letter-spacing: 3px; text-anchor: start; }
      .entity rect { fill: #F7F9FF; stroke: #6677A8; stroke-width: 3; filter: url(#shadow); }
      .entity.role rect { fill: #282C38; stroke: #282C38; }
      .entity.external rect { fill: #F2F9E8; stroke: #7B9D3F; }
      .entity-title { font-size: 24px; font-weight: 800; fill: #283455; }
      .role .entity-title { fill: #FFFFFF; }
      .external .entity-title { fill: #4E6F24; }
      .entity-subtitle { font-size: 14px; fill: #7A85A4; }
      .role .entity-subtitle { fill: #C5CAD9; }
      .external .entity-subtitle { fill: #78924E; }
      .relation polygon { fill: #FFBF27; stroke: #A66D00; stroke-width: 3; filter: url(#shadow); }
      .relation-title { font-size: 19px; font-weight: 800; fill: #342600; }
      .relation-step { font-size: 17px; font-weight: 900; fill: #835500; }
      .attribute ellipse { fill: #EEF2FF; stroke: #8090BF; stroke-width: 2.5; }
      .attribute.multi ellipse { fill: #F5F1FF; stroke: #7A65B7; }
      .attribute-title { font-size: 16px; font-weight: 650; fill: #4B587F; }
      .attribute-title.key { text-decoration: underline; font-weight: 850; }
      .cardinality { font-size: 17px; font-weight: 900; fill: #485A8B; paint-order: stroke; stroke: #FFFFFF; stroke-width: 8px; stroke-linejoin: round; }
      .note rect { fill: #FFFFFF; stroke: #D9DEEC; stroke-width: 2; filter: url(#shadow); }
      .note-title { font-size: 20px; font-weight: 800; fill: #283455; text-anchor: start; }
      .note-line { font-size: 16px; fill: #616C8C; text-anchor: start; }
    </style>
  </defs>
  <rect width="100%" height="100%" fill="#FCFCFE"/>
  <rect width="100%" height="100%" fill="url(#grid)"/>
  <text class="title" x="70" y="64">花彩 Amazon Studio · 角色驱动系统流程 Chen ER 图</text>
  <text class="subtitle" x="70" y="98">从员工角色、SKU 商品、视觉任务、素材与审核，到类目模板、Listing 和 Amazon 发布</text>
  <text class="section-label" x="70" y="165">角色与权限</text>
  <text class="section-label" x="70" y="750">核心生产与上架流程</text>
  <text class="section-label" x="70" y="1280">素材、AI 与 Amazon 类目规则</text>
  <text class="section-label" x="70" y="1880">通知、审计与数据安全</text>
  <g id="edges">${edges.join("\n")}</g>
  <g id="nodes">${nodes.join("\n")}</g>
</svg>`;

const output = path.resolve("docs", "花彩系统详细Chen-ER图.svg");
await fs.mkdir(path.dirname(output), { recursive: true });
await fs.writeFile(output, svg, "utf8");
console.log(output);
