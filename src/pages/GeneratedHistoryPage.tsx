import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  getAssetObjectUrl,
  getGeneratedImagePage,
  type GeneratedImage,
} from "../lib/api";
import type { EmployeeAccount } from "../types/domain";

const pageSize = 16;

function formatDate(date: string) {
  return new Date(date).toLocaleString("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function HistoryThumbnail({ image }: { image: GeneratedImage }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [thumbnailUrl, setThumbnailUrl] = useState("");
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const element = rootRef.current;
    if (!element || !("IntersectionObserver" in window)) {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setVisible(true);
        observer.disconnect();
      }
    }, { rootMargin: "420px 0px" });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!visible) return;
    const controller = new AbortController();
    let objectUrl = "";
    getAssetObjectUrl(image.id, "thumbnail", controller.signal)
      .then((value) => {
        objectUrl = value;
        setThumbnailUrl(value);
      })
      .catch((error) => {
        if (!(error instanceof DOMException && error.name === "AbortError")) setFailed(true);
      });
    return () => {
      controller.abort();
      if (objectUrl.startsWith("blob:")) URL.revokeObjectURL(objectUrl);
    };
  }, [image.id, visible]);

  return (
    <div className="history-thumbnail" ref={rootRef}>
      {thumbnailUrl ? (
        <img src={thumbnailUrl} alt={image.templateTitle || "AI 生成作品"} decoding="async" />
      ) : failed ? (
        <div className="ai-result-missing">缩略图暂不可用</div>
      ) : (
        <div className="history-thumbnail-loading"><i className="spinner" />正在载入缩略图</div>
      )}
    </div>
  );
}

export default function GeneratedHistoryPage({
  currentUser,
  notify,
  onReusePrompt,
}: {
  currentUser: EmployeeAccount;
  notify: (message: string) => void;
  onReusePrompt?: (image: GeneratedImage) => void;
}) {
  const previewRequestRef = useRef<AbortController | null>(null);
  const [images, setImages] = useState<GeneratedImage[]>([]);
  const [total, setTotal] = useState(0);
  const [nextOffset, setNextOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<GeneratedImage | null>(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [previewLoading, setPreviewLoading] = useState(false);

  const loadPage = useCallback(async (offset: number, reset: boolean) => {
    if (reset) setLoading(true);
    else setLoadingMore(true);
    setError("");
    try {
      const page = await getGeneratedImagePage(offset, pageSize);
      setImages((current) => reset ? page.items : [...current, ...page.items]);
      setTotal(page.total);
      setNextOffset(page.nextOffset);
      setHasMore(page.hasMore);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "历史作品读取失败");
    } finally {
      if (reset) setLoading(false);
      else setLoadingMore(false);
    }
  }, []);

  useEffect(() => {
    void loadPage(0, true);
    return () => previewRequestRef.current?.abort();
  }, [loadPage]);

  const filteredImages = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) return images;
    return images.filter((image) => [
      image.templateTitle,
      image.prompt,
      image.ownerName,
      image.ratio,
      image.size,
      image.model,
    ].filter(Boolean).join(" ").toLowerCase().includes(keyword));
  }, [images, query]);

  const downloadName = (image: GeneratedImage) =>
    `huacai-${image.templateTitle || image.ratio}-${image.id}`.replace(/[\\/:*?"<>|]/g, "-");

  const openPreview = async (image: GeneratedImage) => {
    previewRequestRef.current?.abort();
    if (previewUrl.startsWith("blob:")) URL.revokeObjectURL(previewUrl);
    const controller = new AbortController();
    previewRequestRef.current = controller;
    setPreview(image);
    setPreviewUrl("");
    setPreviewLoading(true);
    try {
      const url = await getAssetObjectUrl(image.id, "original", controller.signal);
      if (!controller.signal.aborted) setPreviewUrl(url);
    } catch (reason) {
      if (!controller.signal.aborted) notify(reason instanceof Error ? reason.message : "原图读取失败");
    } finally {
      if (!controller.signal.aborted) setPreviewLoading(false);
    }
  };

  const closePreview = () => {
    previewRequestRef.current?.abort();
    previewRequestRef.current = null;
    if (previewUrl.startsWith("blob:")) URL.revokeObjectURL(previewUrl);
    setPreview(null);
    setPreviewUrl("");
    setPreviewLoading(false);
  };

  const downloadImage = async (image: GeneratedImage) => {
    try {
      const url = preview?.id === image.id && previewUrl
        ? previewUrl
        : await getAssetObjectUrl(image.id, "original");
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = downloadName(image);
      anchor.click();
      if (url !== previewUrl && url.startsWith("blob:")) window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : "作品图片读取失败");
    }
  };

  const reusePrompt = (image: GeneratedImage) => {
    onReusePrompt?.(image);
    if (preview) closePreview();
  };

  return (
    <div className="generated-history-page">
      <section className="history-hero panel">
        <div>
          <span className="eyebrow">GENERATED HISTORY</span>
          <h2>历史生图作品</h2>
          <p>
            这里专门存放 AI 生成后的成品图，适合美工复盘、运营选图和后续下载交付。当前账号：{currentUser.name} · {currentUser.role}
          </p>
        </div>
        <div className="history-hero-actions">
          <label className="template-search">
            <span>⌕</span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索模板、提示词、成员或尺寸"
            />
          </label>
          <button className="secondary-button" type="button" onClick={() => void loadPage(0, true)}>
            刷新作品
          </button>
        </div>
      </section>

      <div className="template-results-head">
        <div>
          <i />
          {loading
            ? "正在读取历史作品"
            : `${currentUser.role === "管理员" ? "团队" : "我的"} ${total} 张作品 · 已加载 ${images.length} 张`}
        </div>
        <span>列表使用轻量缩略图，打开大图或下载时才读取原图</span>
      </div>

      {error && <div className="ai-error" role="alert">! {error}</div>}

      {loading ? (
        <div className="ai-results-loading"><i className="spinner" />正在读取作品列表</div>
      ) : filteredImages.length ? (
        <>
          <section className="history-grid">
            {filteredImages.map((image) => (
              <article className="history-card" key={image.id}>
                <button className="history-card-image" type="button" onClick={() => void openPreview(image)}>
                  <HistoryThumbnail image={image} />
                </button>
                <div className="history-card-body">
                  <div className="history-card-head">
                    <span>
                      <b>{image.templateTitle || `${image.ratio} 商品图`}</b>
                      <small>{image.ownerName} · {formatDate(image.createdAt)} · {image.size}</small>
                    </span>
                    <div className="history-card-actions">
                      <button type="button" onClick={() => reusePrompt(image)}>复用提示词</button>
                      <button type="button" onClick={() => void openPreview(image)}>大图</button>
                      <button type="button" onClick={() => void downloadImage(image)}>下载 ↓</button>
                    </div>
                  </div>
                  <p className="history-prompt">{image.prompt}</p>
                </div>
              </article>
            ))}
          </section>
          {hasMore && !query.trim() && (
            <div className="history-load-more">
              <button type="button" className="secondary-button" disabled={loadingMore} onClick={() => void loadPage(nextOffset, false)}>
                {loadingMore ? "正在加载…" : `加载更多（剩余 ${Math.max(0, total - images.length)} 张）`}
              </button>
            </div>
          )}
        </>
      ) : (
        <section className="panel history-empty">
          <span>□</span>
          <h3>{query.trim() ? "没有匹配的历史作品" : "暂时没有可见的历史作品"}</h3>
          <p>{query.trim() ? "请调整搜索条件，或继续加载更多作品后再搜索。" : "去素材库生成一批图后，这里会自动沉淀成作品库。"}</p>
        </section>
      )}

      {preview && (
        <div className="modal-backdrop" onMouseDown={closePreview}>
          <section className="modal history-preview-modal" onMouseDown={(event) => event.stopPropagation()}>
            <div className="history-preview-image">
              {previewUrl ? (
                <img src={previewUrl} alt={preview.templateTitle || "AI 生成作品预览"} />
              ) : previewLoading ? (
                <div className="history-preview-loading"><i className="spinner" />正在读取原图</div>
              ) : (
                <div className="ai-result-missing">原图暂不可用</div>
              )}
            </div>
            <aside>
              <button className="history-preview-close" type="button" onClick={closePreview}>×</button>
              <span className="eyebrow">IMAGE DETAIL</span>
              <h3>{preview.templateTitle || `${preview.ratio} 商品图`}</h3>
              <dl>
                <div><dt>创建人</dt><dd>{preview.ownerName}</dd></div>
                <div><dt>生成时间</dt><dd>{formatDate(preview.createdAt)}</dd></div>
                <div><dt>尺寸</dt><dd>{preview.size}</dd></div>
                <div><dt>模型</dt><dd>{preview.model}</dd></div>
              </dl>
              <p>{preview.prompt}</p>
              {previewUrl && (
                <a className="primary-button" href={previewUrl} download={downloadName(preview)}>
                  下载原图 <span>↗</span>
                </a>
              )}
              <button className="secondary-button" type="button" onClick={() => reusePrompt(preview)}>
                复用提示词继续生成
              </button>
            </aside>
          </section>
        </div>
      )}
    </div>
  );
}
