import { useEffect, useMemo, useState } from "react";
import { getActivities, getEmployeeAnalytics } from "../lib/api";
import type { ActivityEvent, EmployeeMetric } from "../types/domain";

const activityLabels: Record<string, string> = {
  SKU_CREATED: "新建 SKU",
  IMAGE_UPLOADED: "上传商品图",
  TASK_CREATED: "创建生成任务",
  REVIEW_APPROVED: "审核通过",
  REVIEW_REJECTED: "审核驳回",
  LISTING_DRAFTED: "新建 Listing",
  LISTING_VALIDATED: "校验 Listing",
  LISTING_PUBLISHED: "发布 Listing",
};

export default function PerformancePage() {
  const [days, setDays] = useState(30);
  const [metrics, setMetrics] = useState<EmployeeMetric[]>([]);
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    Promise.all([getEmployeeAnalytics(days), getActivities(50)])
      .then(([analytics, activity]) => {
        setMetrics(analytics.metrics);
        setEvents(activity);
      })
      .finally(() => setLoading(false));
  }, [days]);

  const totals = useMemo(() => ({
    sku: metrics.reduce((sum, item) => sum + item.skuCreated, 0),
    images: metrics.reduce((sum, item) => sum + item.imagesUploaded, 0),
    tasks: metrics.reduce((sum, item) => sum + item.tasksCreated, 0),
    reviews: metrics.reduce((sum, item) => sum + item.reviewsCompleted, 0),
    listings: metrics.reduce((sum, item) => sum + item.listingsPublished, 0),
  }), [metrics]);

  const employeeName = (id: string) => metrics.find((item) => item.id === id)?.name ?? id;

  return (
    <>
      <div className="analytics-toolbar">
        <div className="notice-card"><b>统计原则</b><span>只记录系统内真实操作，不让员工手填数量；按类型展示，不用单一分数粗暴排名。</span></div>
        <select value={days} onChange={(event) => setDays(Number(event.target.value))}>
          <option value={7}>最近 7 天</option>
          <option value={30}>最近 30 天</option>
          <option value={90}>最近 90 天</option>
        </select>
      </div>

      <div className="metric-grid">
        {[
          ["新建 SKU", totals.sku, "◇"],
          ["上传图片", totals.images, "▧"],
          ["生成任务", totals.tasks, "✦"],
          ["完成审核", totals.reviews, "✓"],
          ["发布 Listing", totals.listings, "↗"],
        ].map(([label, value, icon]) => (
          <article className="panel metric-card" key={label}><span>{icon}</span><div><small>{label}</small><strong>{loading ? "—" : value}</strong></div></article>
        ))}
      </div>

      <section className="performance-layout">
        <div className="panel employee-table">
          <div className="panel-head"><div><span className="eyebrow">EMPLOYEE OUTPUT</span><h3>员工工作量明细</h3></div></div>
          <div className="employee-row employee-header">
            <span>员工</span><span>SKU</span><span>图片</span><span>任务</span><span>审核</span><span>Listing</span><span>最后操作</span>
          </div>
          {metrics.map((employee) => (
            <div className="employee-row" key={employee.id}>
              <span className="employee-cell"><i>{employee.name[0]}</i><span><b>{employee.name}</b><small>{employee.department} · {employee.role}</small></span></span>
              <strong>{employee.skuCreated}</strong>
              <strong>{employee.imagesUploaded}</strong>
              <strong>{employee.tasksCreated}</strong>
              <strong>{employee.reviewsCompleted}</strong>
              <strong>{employee.listingsDrafted}/{employee.listingsPublished}</strong>
              <small>{employee.lastActiveAt ? new Date(employee.lastActiveAt).toLocaleString("zh-CN") : "暂无"}</small>
            </div>
          ))}
        </div>
        <div className="panel activity-feed">
          <div className="panel-head"><div><span className="eyebrow">AUDIT LOG</span><h3>最近操作记录</h3></div></div>
          {events.slice(0, 12).map((event) => (
            <article key={event.id}>
              <span>{activityLabels[event.type]?.slice(0, 1) ?? "·"}</span>
              <div><b>{employeeName(event.employeeId)} · {activityLabels[event.type] ?? event.type}</b><small>{event.entityId} · 数量 {event.quantity}</small></div>
              <time>{new Date(event.createdAt).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}</time>
            </article>
          ))}
        </div>
      </section>
    </>
  );
}
