import { useEffect, useMemo, useRef, useState } from "react";
import {
  ApiError,
  createListing,
  generateListingCopy,
  getListings,
  updateListing,
  type ListingGenerationResult,
} from "../lib/api";
import ListingCreateDialog, { listingMarketplaces, type ListingMarketplaceOption } from "../components/ListingCreateDialog";
import { buildListingCreateInputFromProduct } from "../lib/listingDraft";
import {
  buildListingComplianceReport,
  extractCompetitorReference,
  listingClipboardText,
} from "../lib/listingGeneration";
import type { AmazonListing, GenerationTask, Product } from "../types/domain";

function fiveBullets(points: string[]) {
  return Array.from({ length: 5 }, (_, index) => points[index] ?? "");
}

type ListingSourceMode = "competitor_first" | "product_facts";

function productFactsTemplate(listing: AmazonListing, product?: Product) {
  return [
    `商品名称：${product?.name || listing.title || ""}`,
    `品牌：${listing.brand || product?.brand || ""}`,
    `商品类型：${listing.productType || product?.category || ""}`,
    "材质与结构：",
    "尺寸/重量：",
    "颜色/款式：",
    "包装数量及清单：",
    "核心功能与卖点：",
    "适用场景/人群：",
    "兼容型号：",
    "安装、使用与维护：",
    "认证/限制（没有请留空）：",
  ].join("\n");
}

function detailedProductFactCount(value: string) {
  const basicIdentity = /^(?:商品名称|品牌|商品类型|商品类目|类目|站点)\s*[:：]/i;
  return value
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/^[-*•]\s*/, ""))
    .filter((line) => line.length >= 4 && !basicIdentity.test(line) && !/[:：]\s*$/.test(line))
    .length;
}

async function writeClipboard(value: string) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return;
    } catch {
      // HTTP 内网页面可能没有 Clipboard API 权限，继续使用兼容方案。
    }
  }
  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  if (!copied) throw new Error("浏览器未授予剪贴板权限");
}

export default function ListingsPage({
  products,
  tasks: _tasks,
  notify,
  focusSku = "",
  onFocusHandled,
}: {
  products: Product[];
  tasks: GenerationTask[];
  notify: (message: string) => void;
  focusSku?: string;
  onFocusHandled?: () => void;
}) {
  const [listings, setListings] = useState<AmazonListing[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [draft, setDraft] = useState<AmazonListing | null>(null);
  const [listingsLoaded, setListingsLoaded] = useState(false);
  const [competitorUrl, setCompetitorUrl] = useState("");
  const [sourceMode, setSourceMode] = useState<ListingSourceMode>("competitor_first");
  const [productFacts, setProductFacts] = useState("");
  const [instructions, setInstructions] = useState("");
  const [generation, setGeneration] = useState<ListingGenerationResult | null>(null);
  const [generationError, setGenerationError] = useState("");
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [creatingListing, setCreatingListing] = useState(false);
  const focusRequestRef = useRef("");

  const choose = (listing: AmazonListing) => {
    const product = products.find((item) => item.sku.trim().toUpperCase() === listing.sku.trim().toUpperCase());
    setSelectedId(listing.id);
    setDraft(structuredClone(listing));
    setCompetitorUrl(listing.competitorUrl ?? "");
    setSourceMode("competitor_first");
    setProductFacts(productFactsTemplate(listing, product));
    setInstructions("");
    setGeneration(null);
    setGenerationError("");
    setDirty(false);
  };

  const load = async () => {
    try {
      const items = await getListings();
      setListings(items);
      const current = items.find((item) => item.id === selectedId) ?? items[0];
      if (current) choose(current);
      else {
        setSelectedId("");
        setDraft(null);
      }
    } catch (error) {
      setListings([]);
      setDraft(null);
      notify(error instanceof Error ? error.message : "Listing 加载失败");
    } finally {
      setListingsLoaded(true);
    }
  };

  useEffect(() => { void load(); }, []);

  const useExistingListingFromConflict = (error: unknown) => {
    const listing = error instanceof ApiError ? error.data.listing as AmazonListing | undefined : undefined;
    if (error instanceof ApiError && error.code === "LISTING_ALREADY_EXISTS" && listing?.id) {
      setListings((current) => current.some((item) => item.id === listing.id)
        ? current.map((item) => item.id === listing.id ? listing : item)
        : [listing, ...current]);
      choose(listing);
      notify(`${error.message}，已切换到现有草稿`);
      return true;
    }
    return false;
  };

  const openCreateDialog = () => {
    if (!products.length) {
      notify("请先在 SKU 商品库创建商品，再新建 Listing");
      return;
    }
    setCreateDialogOpen(true);
  };

  const add = async (product: Product, marketplace: ListingMarketplaceOption) => {
    setCreatingListing(true);
    try {
      const listing = await createListing(buildListingCreateInputFromProduct(product, marketplace));
      setListings((current) => [listing, ...current]);
      choose(listing);
      setCreateDialogOpen(false);
      notify(`${product.sku} 的 ${marketplace.name} Listing 草稿已创建`);
    } catch (error) {
      if (!useExistingListingFromConflict(error)) notify(error instanceof Error ? error.message : "Listing 创建失败");
      setCreateDialogOpen(false);
    } finally {
      setCreatingListing(false);
    }
  };

  useEffect(() => {
    const normalizedSku = focusSku.trim().toUpperCase();
    if (!normalizedSku) {
      focusRequestRef.current = "";
      return;
    }
    if (!listingsLoaded || focusRequestRef.current === normalizedSku) return;
    focusRequestRef.current = normalizedSku;

    const existing = listings.find((listing) => listing.sku.trim().toUpperCase() === normalizedSku);
    if (existing) {
      choose(existing);
      notify(`已定位 ${existing.sku} 的 Listing 草稿`);
      onFocusHandled?.();
      return;
    }

    const product = products.find((item) => item.sku.trim().toUpperCase() === normalizedSku);
    if (!product) {
      notify(`没有找到 SKU ${focusSku} 的商品资料`);
      onFocusHandled?.();
      return;
    }

    const marketplace = listingMarketplaces.find((item) => item.name === product.marketplace) ?? listingMarketplaces[0];
    setCreatingListing(true);
    createListing(buildListingCreateInputFromProduct(product, marketplace))
      .then((listing) => {
        setListings((current) => [listing, ...current]);
        choose(listing);
        notify(`${product.sku} 尚无 Listing，已自动创建草稿`);
      })
      .catch((error) => {
        if (!useExistingListingFromConflict(error)) notify(error instanceof Error ? error.message : "Listing 自动创建失败");
      })
      .finally(() => {
        setCreatingListing(false);
        onFocusHandled?.();
      });
  }, [focusSku, listingsLoaded, listings, products]);

  const change = <K extends keyof AmazonListing>(key: K, value: AmazonListing[K]) => {
    setDraft((current) => current ? { ...current, [key]: value } : current);
    setDirty(true);
  };

  const competitorReference = useMemo(() => extractCompetitorReference(competitorUrl), [competitorUrl]);
  const competitorAsin = competitorReference?.id ?? "";
  const compliance = useMemo(
    () => draft ? buildListingComplianceReport(draft, generation?.copy.assumptions ?? []) : null,
    [draft, generation],
  );
  const errors = compliance?.issues.filter((issue) => issue.severity === "error") ?? [];
  const warnings = compliance?.issues.filter((issue) => issue.severity === "warning") ?? [];
  const matchedProduct = draft
    ? products.find((product) => product.sku.trim().toUpperCase() === draft.sku.trim().toUpperCase())
    : undefined;
  const verifiedFactCount = useMemo(() => detailedProductFactCount(productFacts), [productFacts]);

  const generate = async () => {
    if (!draft || generating) return;
    if (sourceMode === "competitor_first" && !competitorAsin) {
      setGenerationError("请粘贴完整的 Amazon 商品链接或 Etsy /listing/数字ID 商品链接");
      return;
    }
    if (sourceMode === "product_facts" && verifiedFactCount < 3 && productFacts.trim().length < 80) {
      setGenerationError("请至少填写 3 条已核实的商品事实，例如材质、尺寸、包装数量、功能、兼容性或使用场景");
      return;
    }
    setGenerating(true);
    setGenerationError("");
    try {
      const result = await generateListingCopy({
        listingId: draft.id,
        generationMode: sourceMode,
        competitorUrl: sourceMode === "competitor_first" ? competitorUrl.trim() : undefined,
        productFacts: sourceMode === "product_facts" ? productFacts.trim() : undefined,
        instructions: sourceMode === "product_facts" ? instructions.trim() : undefined,
      });
      const next: AmazonListing = {
        ...draft,
        title: result.copy.title,
        bulletPoints: fiveBullets(result.copy.bulletPoints),
        description: result.copy.description,
        searchTerms: result.copy.searchTerms,
        competitorUrl: result.competitor?.canonicalUrl,
        competitorAsin: result.competitor?.asin,
        aiGeneratedAt: new Date().toISOString(),
        latestGenerationId: result.generationId,
      };
      setDraft(next);
      if (result.competitor) setCompetitorUrl(result.competitor.canonicalUrl);
      setGeneration(result);
      setDirty(true);
      notify(result.competitor
        ? `已读取 ${result.competitor.sourceLabel} ${result.competitor.source === "amazon" ? "ASIN" : "Listing ID"} ${result.competitor.externalId} 并生成 Listing，请检查后保存`
        : "已根据核实商品资料生成 Listing，请检查后保存");
    } catch (error) {
      const message = error instanceof Error ? error.message : "AI Listing 生成失败";
      setGenerationError(message);
      notify(message);
    } finally {
      setGenerating(false);
    }
  };

  const save = async () => {
    if (!draft || saving) return;
    setSaving(true);
    try {
      const result = await updateListing({
        ...draft,
        competitorUrl: sourceMode === "competitor_first" ? competitorUrl.trim() : "",
        competitorAsin: sourceMode === "competitor_first" ? (competitorAsin || draft.competitorAsin) : "",
      });
      setDraft(result);
      setListings((current) => current.map((item) => item.id === result.id ? result : item));
      setDirty(false);
      notify("AI Listing 已保存到草稿");
    } catch (error) {
      if (!useExistingListingFromConflict(error)) notify(error instanceof Error ? error.message : "Listing 保存失败");
    } finally {
      setSaving(false);
    }
  };

  const copy = async (label: string, value: string) => {
    try {
      await writeClipboard(value);
      notify(`${label}已复制`);
    } catch (error) {
      notify(error instanceof Error ? error.message : "复制失败");
    }
  };

  return (
    <>
      <section className="listing-layout listing-simple-layout">
        <aside className="panel listing-sidebar listing-simple-sidebar">
          <div className="listing-side-head">
            <div><span className="eyebrow">LISTING DRAFTS</span><h3>Listing 草稿</h3></div>
            <button type="button" aria-label="新建 Listing" onClick={openCreateDialog}>＋</button>
          </div>
          <p className="listing-side-tip">选择公司 SKU，可用竞品链接或已核实商品资料生成文案。</p>
          {listings.map((listing) => (
            <button className={listing.id === selectedId ? "active" : ""} onClick={() => choose(listing)} key={listing.id}>
              <span>
                <b>{listing.sku}</b>
                <small>{listing.marketplaceName} · {listing.productType || "未选类目"}</small>
              </span>
              <em className={`listing-status ${listing.aiGeneratedAt ? "ai-ready" : "ai-pending"}`}>
                {listing.aiGeneratedAt ? "AI 已生成" : "待生成"}
              </em>
            </button>
          ))}
        </aside>

        {draft ? (
          <main className="panel listing-ai-page">
            <header className="listing-ai-header">
              <div>
                <span className="eyebrow">AMAZON / ETSY AI LISTING</span>
                <h2>{draft.sku}</h2>
                <p>可读取 Amazon / Etsy 竞品，也可直接根据已核实的公司商品资料生成标题、五点、描述与 Search Terms。</p>
                <small className="listing-ai-ownership">草稿创建人：{draft.ownerName || "历史账号"} · 最后编辑：{draft.lastEditedByName || draft.ownerName || "暂无"}</small>
              </div>
              <div className="listing-ai-product-tags">
                <span className="listing-ai-mode-tag">{sourceMode === "competitor_first" ? "竞品优先" : "商品资料"}</span>
                <span>{draft.marketplaceName}</span>
                <span>{draft.productType || matchedProduct?.category || "类目待确认"}</span>
                <span>{draft.brand || matchedProduct?.brand || "品牌待确认"}</span>
              </div>
            </header>

            <section className="listing-ai-source-card">
              <div className="listing-source-tabs" role="tablist" aria-label="Listing 生成来源">
                <button
                  type="button"
                  role="tab"
                  aria-selected={sourceMode === "competitor_first"}
                  className={sourceMode === "competitor_first" ? "active" : ""}
                  onClick={() => {
                    setSourceMode("competitor_first");
                    setGenerationError("");
                    setGeneration(null);
                  }}
                >
                  竞品链接生成
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={sourceMode === "product_facts"}
                  className={sourceMode === "product_facts" ? "active" : ""}
                  onClick={() => {
                    setSourceMode("product_facts");
                    if (!productFacts.trim() && draft) setProductFacts(productFactsTemplate(draft, matchedProduct));
                    setGenerationError("");
                    setGeneration(null);
                  }}
                >
                  商品资料生成
                </button>
              </div>
              <div className="listing-ai-step-title">
                <i>01</i>
                <div>
                  <b>{sourceMode === "competitor_first" ? "输入竞品链接" : "填写已核实商品资料"}</b>
                  <small>{sourceMode === "competitor_first" ? "竞品决定商品类型和事实；SKU 仅提供目标品牌与保存位置" : "AI 只使用这里的真实资料，缺失信息不会自行编造"}</small>
                </div>
              </div>
              {sourceMode === "competitor_first" ? (
                <>
                  <div className="listing-ai-url-row">
                    <label>
                      <span>Amazon / Etsy 竞品 URL</span>
                      <input
                        value={competitorUrl}
                        onChange={(event) => {
                          setCompetitorUrl(event.target.value);
                          setGenerationError("");
                        }}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.preventDefault();
                            void generate();
                          }
                        }}
                        placeholder="粘贴 Amazon /dp/ASIN 或 Etsy /listing/数字ID 链接"
                        aria-label="Amazon 或 Etsy 竞品链接"
                      />
                    </label>
                    <button type="button" className="primary-button listing-ai-generate" disabled={generating || !competitorAsin} onClick={() => void generate()}>
                      {generating ? "正在读取竞品并生成…" : "AI 生成 Listing"} <span>↗</span>
                    </button>
                  </div>
                  <div className={`listing-ai-asin ${competitorReference ? "detected" : ""}`}>
                    <span>{competitorReference ? "✓" : "○"}</span>
                    <div>
                      <b>{competitorReference ? `已识别 ${competitorReference.sourceLabel} ${competitorReference.idLabel}：${competitorReference.id}` : "等待识别竞品链接"}</b>
                      <small>{competitorReference ? "生成时会读取该商品页的公开标题、卖点和描述，不保存网页原文。" : "支持 Amazon 商品详情页和 Etsy /listing/数字ID 商品详情页。"}</small>
                    </div>
                  </div>
                </>
              ) : (
                <div className="listing-product-facts">
                  <label>
                    <span>已核实商品资料 <em>{verifiedFactCount} 条有效事实</em></span>
                    <textarea
                      value={productFacts}
                      rows={12}
                      maxLength={6000}
                      aria-label="已核实商品资料"
                      onChange={(event) => {
                        setProductFacts(event.target.value);
                        setGenerationError("");
                      }}
                    />
                    <small>至少补充 3 条真实事实。没有确认的材质、尺寸、认证、承重或兼容性请留空。</small>
                  </label>
                  <label>
                    <span>目标关键词与运营要求 <em>可选</em></span>
                    <textarea
                      value={instructions}
                      rows={4}
                      maxLength={2000}
                      aria-label="目标关键词与运营要求"
                      placeholder="例如：目标关键词、目标买家、语气要求，以及禁止出现的表达"
                      onChange={(event) => setInstructions(event.target.value)}
                    />
                  </label>
                  <button
                    type="button"
                    className="primary-button listing-ai-generate"
                    disabled={generating || (verifiedFactCount < 3 && productFacts.trim().length < 80)}
                    onClick={() => void generate()}
                  >
                    {generating ? "正在根据商品资料生成…" : "AI 生成 Listing"} <span>↗</span>
                  </button>
                </div>
              )}
              {generationError && <div className="listing-ai-error">{generationError}</div>}
              {generation?.competitor?.extractedTitle && (
                <div className="listing-ai-source-result">
                  <span>竞品读取成功</span>
                  <b>{generation.competitor.extractedTitle}</b>
                  <small>{generation.competitor.sourceLabel} · {generation.competitor.source === "amazon" ? "ASIN" : "Listing ID"} {generation.competitor.externalId}{generation.competitor.extractedBrand ? ` · 原品牌 ${generation.competitor.extractedBrand}` : ""} · 模型 {generation.model}</small>
                </div>
              )}
              {generation?.generationMode === "product_facts" && (
                <div className="listing-ai-source-result facts-ready">
                  <span>商品资料读取成功</span>
                  <b>已使用 {verifiedFactCount} 条核实事实生成文案</b>
                  <small>来源：公司 SKU 商品资料 · 模型 {generation.model}</small>
                </div>
              )}
            </section>

            <div className="listing-ai-workspace">
              <section className="listing-ai-copy-editor">
                <div className="listing-ai-section-head">
                  <div className="listing-ai-step-title"><i>02</i><div><b>AI 文案</b><small>生成后仍可人工修改</small></div></div>
                  <span className={dirty ? "unsaved" : "saved"}>{dirty ? "● 有未保存修改" : "✓ 草稿已保存"}</span>
                </div>

                <article className="listing-ai-field-card">
                  <div className="listing-ai-field-head">
                    <label htmlFor="listing-title">商品标题</label>
                    <div><span>{draft.title.length}/{compliance?.titleLimit ?? 75}</span><button type="button" onClick={() => void copy("标题", draft.title)}>复制</button></div>
                  </div>
                  <textarea id="listing-title" className="listing-ai-title-input" value={draft.title} rows={2} onChange={(event) => change("title", event.target.value)} />
                  <small>已预适配 Amazon 2026 年 7 月 27 日标题新规；非媒体类目不超过 75 字符。</small>
                </article>

                <article className="listing-ai-field-card">
                  <div className="listing-ai-field-head"><label>五点卖点</label><span>5 条 · 每条最多 255 字符</span></div>
                  <div className="listing-ai-bullets">
                    {fiveBullets(draft.bulletPoints).map((point, index) => (
                      <label key={index}>
                        <i>{index + 1}</i>
                        <textarea
                          value={point}
                          maxLength={255}
                          rows={3}
                          aria-label={`卖点 ${index + 1}`}
                          onChange={(event) => {
                            const next = fiveBullets(draft.bulletPoints);
                            next[index] = event.target.value;
                            change("bulletPoints", next);
                          }}
                        />
                        <button type="button" onClick={() => void copy(`卖点 ${index + 1}`, point)}>复制</button>
                      </label>
                    ))}
                  </div>
                </article>

                <article className="listing-ai-field-card">
                  <div className="listing-ai-field-head">
                    <label htmlFor="listing-description">商品描述</label>
                    <div><span>{draft.description.length}/2000</span><button type="button" onClick={() => void copy("商品描述", draft.description)}>复制</button></div>
                  </div>
                  <textarea id="listing-description" value={draft.description} rows={7} onChange={(event) => change("description", event.target.value)} />
                </article>

                <article className="listing-ai-field-card">
                  <div className="listing-ai-field-head">
                    <label htmlFor="listing-search-terms">Search Terms</label>
                    <button type="button" onClick={() => void copy("Search Terms", draft.searchTerms)}>复制</button>
                  </div>
                  <textarea id="listing-search-terms" value={draft.searchTerms} rows={3} onChange={(event) => change("searchTerms", event.target.value)} />
                  <small>使用空格分隔，系统按 250 UTF-8 字节检查。</small>
                </article>
              </section>

              <aside className="listing-ai-compliance">
                <div className="listing-ai-step-title"><i>03</i><div><b>Amazon 规则检查</b><small>编辑时实时更新</small></div></div>
                <div className={`listing-ai-rule-summary ${compliance?.compliant ? "passed" : "failed"}`}>
                  <strong>{compliance?.compliant ? "规则检查通过" : `${errors.length} 个问题待处理`}</strong>
                  <span>{warnings.length ? `另有 ${warnings.length} 条提醒` : "没有额外提醒"}</span>
                </div>

                <div className="listing-ai-rule-basics">
                  <span><i>✓</i> 标题长度与禁用字符</span>
                  <span><i>✓</i> 实义词不过度重复</span>
                  <span><i>✓</i> 五点数量、长度与 emoji</span>
                  <span><i>✓</i> 无促销、退款保证和外链</span>
                  <span><i>✓</i> Search Terms 字节限制</span>
                </div>

                {(compliance?.issues.length ?? 0) > 0 && (
                  <div className="listing-ai-issues">
                    {compliance?.issues.map((issue, index) => (
                      <div className={issue.severity} key={`${issue.code}-${issue.index ?? index}`}>
                        <i>{issue.severity === "error" ? "!" : "?"}</i>
                        <span><b>{issue.severity === "error" ? "需要修改" : "请确认"}</b><small>{issue.message}</small></span>
                      </div>
                    ))}
                  </div>
                )}

                {generation && (generation.copy.competitorInsights.length > 0 || generation.copy.warnings.length > 0) && (
                  <details className="listing-ai-insights" open>
                    <summary>AI 分析说明</summary>
                    {generation.copy.competitorInsights.map((item) => <p key={item}>• {item}</p>)}
                    {generation.copy.warnings.map((item) => <p key={item}>• {item}</p>)}
                  </details>
                )}

                <div className="listing-ai-policy-note">
                  <b>官方规则说明</b>
                  <p>系统使用通用规则做第一层检查；不同站点和类目仍可能有更严格要求，上架前需在 Seller Central 再确认。</p>
                  <p>7 月 27 日新规还增加 125 字符 Item Highlights，本期先不写入，避免错误映射类目字段。</p>
                </div>

                <div className="listing-ai-actions">
                  <button type="button" className="secondary-button" onClick={() => void copy("整套 Listing", listingClipboardText(draft))}>复制全部内容</button>
                  <button type="button" className="primary-button" disabled={saving || !dirty} onClick={() => void save()}>
                    {saving ? "保存中…" : dirty ? "保存到 Listing 草稿" : "草稿已保存"} <span>↗</span>
                  </button>
                </div>
              </aside>
            </div>
          </main>
        ) : (
          <div className="panel empty listing-ai-empty">
            <span>＋</span><h3>还没有 Listing 草稿</h3><p>点击左侧加号，从公司 SKU 创建一条草稿。</p>
            <button type="button" className="primary-button" onClick={openCreateDialog}>选择 SKU 创建</button>
          </div>
        )}
      </section>

      {createDialogOpen && (
        <ListingCreateDialog
          products={products}
          listings={listings}
          creating={creatingListing}
          onClose={() => setCreateDialogOpen(false)}
          onCreate={add}
        />
      )}
    </>
  );
}
