import { useEffect, useState } from "react";
import { createListing, getAmazonStatus, getListings, refreshListingStatus, submitListing, updateListing, validateListing } from "../lib/api";
import type { AmazonListing, Product } from "../types/domain";

export default function ListingsPage({ products, notify }: { products: Product[]; notify: (message: string) => void }) {
  const [listings, setListings] = useState<AmazonListing[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [draft, setDraft] = useState<AmazonListing | null>(null);
  const [configured, setConfigured] = useState(false);
  const [connectorReady, setConnectorReady] = useState(false);
  const [amazonMode, setAmazonMode] = useState("sandbox");
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const load = async () => {
    try {
      const [items, status] = await Promise.all([getListings(), getAmazonStatus()]);
      setListings(items);
      setConfigured(status.configured);
      setConnectorReady(status.connectorReady);
      setAmazonMode(status.mode);
      const current = items.find((item) => item.id === selectedId) ?? items[0];
      if (current) {
        setSelectedId(current.id);
        setDraft(structuredClone(current));
      }
    } catch (error) {
      setListings([]);
      setDraft(null);
      notify(error instanceof Error ? error.message : "Listing 加载失败");
    }
  };

  useEffect(() => { void load(); }, []);

  const choose = (listing: AmazonListing) => {
    setSelectedId(listing.id);
    setDraft(structuredClone(listing));
  };

  const add = async () => {
    const product = products[0];
    const listing = await createListing({
      sku: product?.sku ?? `NEW-${Date.now()}`,
      title: product?.name ?? "",
      brand: product?.brand ?? "",
      marketplaceId: "ATVPDKIKX0DER",
      marketplaceName: "美国站",
      productType: product?.category === "Electronics" ? "HEADPHONES" : "",
      currency: "USD",
      bulletPoints: ["", "", "", "", ""],
      ownerId: "emp-zhang",
    });
    setListings((current) => [listing, ...current]);
    choose(listing);
    notify("Listing 草稿已创建");
  };

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    try {
      const result = await updateListing(draft);
      setDraft(result);
      setListings((current) => current.map((item) => item.id === result.id ? result : item));
      notify("Listing 已保存");
    } finally {
      setSaving(false);
    }
  };

  const validate = async () => {
    if (!draft) return;
    await save();
    const result = await validateListing(draft.id);
    setDraft(result.listing);
    setListings((current) => current.map((item) => item.id === result.listing.id ? result.listing : item));
    notify(
      result.listing.issues.length
        ? `发现 ${result.listing.issues.length} 个待完善项`
        : result.amazonSchemaValidation === "ready"
          ? "本地基础检查通过；Amazon 发布连接器尚未启用"
          : "本地基础检查通过；需由管理员连接 Amazon SP-API 后才能官方校验",
    );
  };

  const submit = async () => {
    if (!draft) return;
    try {
      const result = await submitListing(draft.id);
      setDraft(result.listing);
      setListings((current) => current.map((item) => item.id === result.listing.id ? result.listing : item));
      notify(result.amazon.status === "ACCEPTED" ? "Amazon 已接受提交，正在处理" : "Listing 已发送到 Amazon");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Amazon 提交失败");
    }
  };

  const refreshAmazonStatus = async () => {
    if (!draft || refreshing) return;
    setRefreshing(true);
    try {
      const result = await refreshListingStatus(draft.id);
      setDraft(result.listing);
      setListings((current) => current.map((item) => item.id === result.listing.id ? result.listing : item));
      notify(result.listing.status === "已发布" ? "Amazon Listing 已确认发布" : "已同步 Amazon 最新处理状态");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Amazon 状态查询失败");
    } finally {
      setRefreshing(false);
    }
  };

  const change = <K extends keyof AmazonListing>(key: K, value: AmazonListing[K]) => {
    setDraft((current) => current ? { ...current, [key]: value } : current);
  };

  return (
    <section className="listing-layout">
      <aside className="panel listing-sidebar">
        <div className="listing-side-head"><div><span className="eyebrow">LISTING QUEUE</span><h3>商品 Listing</h3></div><button onClick={add}>＋</button></div>
        {listings.map((listing) => (
          <button className={listing.id === selectedId ? "active" : ""} onClick={() => choose(listing)} key={listing.id}>
            <span><b>{listing.sku}</b><small>{listing.marketplaceName} · {listing.productType || "未选类目"}</small></span>
            <em className={`listing-status status-${listing.status}`}>{listing.status}</em>
          </button>
        ))}
      </aside>
      {draft ? (
        <div className="panel listing-editor">
          <div className="listing-editor-head">
            <div><span className="eyebrow">AMAZON LISTING EDITOR</span><h2>{draft.sku}</h2><p>当前可编辑和检查 Listing；完成卖家平台授权后，才可以由花彩直接提交到 Amazon。</p></div>
            <span className={`connection ${connectorReady ? "online" : ""}`}>
              {connectorReady ? `● Amazon ${amazonMode === "sandbox" ? "沙盒" : "正式店铺"}已连接` : configured ? "◐ 授权资料已配置 · 发布待启用" : "○ Amazon 尚未授权"}
            </span>
          </div>
          {!connectorReady && (
            <div className="amazon-authorization-note">
              <span>↗</span>
              <div>
                <b>{configured ? "卖家授权资料已保存，但发布连接器尚未启用" : "什么是连接 Amazon？"}</b>
                <p>{configured
                  ? "目前仍可保存草稿和执行本地检查；启用 SP-API 发布连接器后才能直接上架。"
                  : "由管理员在 Amazon Seller Central 授权花彩访问指定店铺。授权后，运营才能在这里提交 Listing、查询处理结果；普通员工不需要提供亚马逊密码。"}</p>
              </div>
            </div>
          )}
          <div className="listing-grid">
            <label>目标站点<select value={draft.marketplaceId} onChange={(event) => change("marketplaceId", event.target.value)}><option value="ATVPDKIKX0DER">美国站</option><option value="A1F83G8C2ARO7P">英国站</option><option value="A1PA6795UKMFR9">德国站</option><option value="A1VC38T7YXB528">日本站</option></select></label>
            <label>Product Type<input value={draft.productType} onChange={(event) => change("productType", event.target.value.toUpperCase())} placeholder="例如 HEADPHONES" /></label>
            <label>品牌<input value={draft.brand} onChange={(event) => change("brand", event.target.value)} /></label>
            <label>SKU<input value={draft.sku} onChange={(event) => change("sku", event.target.value)} /></label>
          </div>
          <label className="listing-field">英文标题 <span>{draft.title.length}/200</span><input value={draft.title} maxLength={200} onChange={(event) => change("title", event.target.value)} /></label>
          <div className="bullet-fields">
            <b>五点卖点</b>
            {draft.bulletPoints.map((point, index) => (
              <label key={index}><span>{index + 1}</span><textarea value={point} maxLength={500} onChange={(event) => {
                const next = [...draft.bulletPoints]; next[index] = event.target.value; change("bulletPoints", next);
              }} /></label>
            ))}
          </div>
          <label className="listing-field">商品描述<textarea value={draft.description} onChange={(event) => change("description", event.target.value)} /></label>
          <label className="listing-field">Search Terms<input value={draft.searchTerms} onChange={(event) => change("searchTerms", event.target.value)} /></label>
          <div className="listing-grid">
            <label>售价<input type="number" min="0" step="0.01" value={draft.price} onChange={(event) => change("price", Number(event.target.value))} /></label>
            <label>库存<input type="number" min="0" value={draft.quantity} onChange={(event) => change("quantity", Number(event.target.value))} /></label>
          </div>
          {draft.issues.length > 0 && <div className="listing-issues"><b>提交前需要处理</b>{draft.issues.map((issue) => <p key={issue}>• {issue}</p>)}</div>}
          <div className="listing-actions">
            <button className="secondary-button" onClick={save} disabled={saving}>{saving ? "保存中…" : "保存草稿"}</button>
            <button className="secondary-button" onClick={validate}>本地检查 Listing</button>
            {(draft.status === "提交中" || draft.status === "已发布") && (
              <button className="secondary-button" disabled={refreshing} onClick={refreshAmazonStatus}>{refreshing ? "同步中…" : "查询 Amazon 状态"}</button>
            )}
            <button className="primary-button" onClick={submit} disabled={!connectorReady || draft.status !== "可提交"}>
              {draft.status === "提交中" ? "Amazon 处理中" : draft.status === "已发布" ? "Amazon 已发布" : connectorReady ? `提交到 Amazon ${amazonMode === "sandbox" ? "沙盒" : "正式店铺"}` : configured ? "发布连接器待启用" : "Amazon 尚未授权"} <span>↗</span>
            </button>
          </div>
        </div>
      ) : <div className="panel empty"><span>＋</span><h3>还没有 Listing</h3><p>点击左上角加号，从 SKU 创建一条 Listing。</p></div>}
    </section>
  );
}
