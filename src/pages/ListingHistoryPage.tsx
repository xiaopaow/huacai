import { useCallback, useEffect, useMemo, useState } from "react";
import { deleteListingGeneration, getListingHistory, restoreListingGeneration } from "../lib/api";
import type { EmployeeAccount, ListingGenerationRecord } from "../types/domain";

function formatDate(value: string) {
  return new Date(value).toLocaleString("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function recordCopy(record: ListingGenerationRecord) {
  return record.savedCopy ?? record;
}

function competitorLabel(record: ListingGenerationRecord) {
  if (record.generationMode === "product_facts") return "SKU 商品资料";
  const id = record.competitorExternalId || record.competitorAsin;
  return record.competitorSource === "etsy" ? `Etsy Listing ID ${id}` : `Amazon ASIN ${id || "历史记录"}`;
}

function clipboardText(record: ListingGenerationRecord) {
  const copy = recordCopy(record);
  return [
    `SKU: ${record.sku}`,
    `Title: ${copy.title}`,
    "",
    "Bullet Points:",
    ...copy.bulletPoints.map((item, index) => `${index + 1}. ${item}`),
    "",
    `Description: ${copy.description}`,
    "",
    `Search Terms: ${copy.searchTerms}`,
  ].join("\n");
}

export default function ListingHistoryPage({
  currentUser,
  notify,
  onOpenListing,
}: {
  currentUser: EmployeeAccount;
  notify: (message: string) => void;
  onOpenListing: (sku: string) => void;
}) {
  const [records, setRecords] = useState<ListingGenerationRecord[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [restoringId, setRestoringId] = useState("");
  const [deletingId, setDeletingId] = useState("");
  const [selected, setSelected] = useState<ListingGenerationRecord | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRecords(await getListingHistory(100));
    } catch (error) {
      notify(error instanceof Error ? error.message : "Listing 历史读取失败");
    } finally {
      setLoading(false);
    }
  }, [notify]);

  useEffect(() => { void load(); }, [load]);

  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) return records;
    return records.filter((record) => [
      record.sku,
      record.generatedByName,
      record.competitorAsin,
      record.competitorExternalId,
      record.competitorTitle,
      record.generationMode === "product_facts" ? "SKU 商品资料" : "",
      record.title,
      record.model,
    ].filter(Boolean).join(" ").toLowerCase().includes(keyword));
  }, [records, query]);

  const copy = async (record: ListingGenerationRecord) => {
    try {
      await navigator.clipboard.writeText(clipboardText(record));
      notify(`${record.sku} V${record.version} 已复制`);
    } catch {
      notify("浏览器未授予剪贴板权限");
    }
  };

  const restore = async (record: ListingGenerationRecord) => {
    setRestoringId(record.id);
    try {
      await restoreListingGeneration(record.id);
      notify(`${record.sku} 已恢复为 V${record.version}`);
      setSelected(null);
      onOpenListing(record.sku);
    } catch (error) {
      notify(error instanceof Error ? error.message : "历史版本恢复失败");
    } finally {
      setRestoringId("");
    }
  };

  const remove = async (record: ListingGenerationRecord) => {
    if (!window.confirm(`确认删除 ${record.sku} 的 V${record.version} 历史记录？\n\n删除后将从历史库隐藏，但不会影响员工统计和审计记录。`)) return;
    setDeletingId(record.id);
    try {
      await deleteListingGeneration(record.id);
      setRecords((current) => current.filter((item) => item.id !== record.id));
      setSelected((current) => current?.id === record.id ? null : current);
      notify(`${record.sku} V${record.version} 已删除`);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Listing 历史记录删除失败");
    } finally {
      setDeletingId("");
    }
  };

  return (
    <div className="listing-history-page">
      <section className="panel listing-history-hero">
        <div>
          <span className="eyebrow">LISTING GENERATION HISTORY</span>
          <h2>Listing AI 生成历史</h2>
          <p>{currentUser.role === "管理员" ? "管理员可查看全部员工的生成版本。" : "这里只显示你自己生成的 Listing，不展示团队总量。"}</p>
        </div>
        <label className="template-search">
          <span>⌕</span>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索 SKU、ASIN、Etsy ID、标题或创建人" />
        </label>
      </section>

      <div className="template-results-head">
        <div><i />{loading ? "正在读取历史" : `${currentUser.role === "管理员" ? "可见" : "我的"} ${filtered.length} 个生成版本`}</div>
        <span>每次 AI 成功生成都会独立保存，不会被后续版本覆盖</span>
      </div>

      {!loading && filtered.length ? (
        <section className="listing-history-grid">
          {filtered.map((record) => {
            const copyData = recordCopy(record);
            const errors = record.compliance.issues.filter((issue) => issue.severity === "error").length;
            return (
              <article className="panel listing-history-card" key={record.id}>
                <div className="listing-history-card-head">
                  <span><b>{record.sku}</b><small>{record.marketplaceName} · {record.productType || "未选类目"}</small></span>
                  <em>V{record.version}</em>
                </div>
                <h3>{copyData.title || "未生成标题"}</h3>
                <div className="listing-history-meta">
                  <span>创建人 <b>{record.generatedByName}</b></span>
                  <span>{formatDate(record.generatedAt)}</span>
                  <span>竞品 {competitorLabel(record)}</span>
                  <span>{record.model}</span>
                </div>
                <div className={`listing-history-check ${errors ? "failed" : "passed"}`}>
                  {errors ? `${errors} 个规则问题` : "规则检查通过"}{record.adoptedAt ? " · 已保存采用" : " · 尚未保存"}
                </div>
                <p>{copyData.bulletPoints[0] || copyData.description || "暂无内容"}</p>
                <div className="listing-history-actions">
                  <button type="button" className="danger" disabled={deletingId === record.id} onClick={() => void remove(record)}>
                    {deletingId === record.id ? "删除中…" : "删除记录"}
                  </button>
                  <button type="button" onClick={() => setSelected(record)}>查看全文</button>
                  <button type="button" onClick={() => void copy(record)}>复制全部</button>
                  <button type="button" className="dark" disabled={restoringId === record.id} onClick={() => void restore(record)}>
                    {restoringId === record.id ? "恢复中…" : "恢复到草稿"}
                  </button>
                </div>
              </article>
            );
          })}
        </section>
      ) : !loading ? (
        <section className="panel history-empty"><span>A</span><h3>还没有 Listing 生成历史</h3><p>在 Listing 中心成功生成一次文案后，这里会自动保存版本。</p></section>
      ) : null}

      {selected && (
        <div className="modal-backdrop" onMouseDown={() => setSelected(null)}>
          <section className="modal listing-history-modal" onMouseDown={(event) => event.stopPropagation()}>
            <button className="history-preview-close" type="button" onClick={() => setSelected(null)}>×</button>
            <span className="eyebrow">{selected.sku} · VERSION {selected.version}</span>
            <h3>{recordCopy(selected).title}</h3>
            <small>{selected.generatedByName} · {formatDate(selected.generatedAt)} · {competitorLabel(selected)}</small>
            <h4>五点卖点</h4>
            <ol>{recordCopy(selected).bulletPoints.map((item, index) => <li key={index}>{item}</li>)}</ol>
            <h4>商品描述</h4><p>{recordCopy(selected).description}</p>
            <h4>Search Terms</h4><p>{recordCopy(selected).searchTerms}</p>
            <div className="listing-history-actions">
              <button type="button" className="danger" disabled={deletingId === selected.id} onClick={() => void remove(selected)}>
                {deletingId === selected.id ? "删除中…" : "删除记录"}
              </button>
              <button type="button" onClick={() => void copy(selected)}>复制全部</button>
              <button type="button" className="dark" onClick={() => void restore(selected)}>恢复到草稿</button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
