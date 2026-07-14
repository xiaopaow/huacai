import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getAssetObjectUrl, getGeneratedImages, type GeneratedImage } from "../lib/api";
import type { EmployeeAccount } from "../types/domain";

type LoadedGeneratedImage = GeneratedImage & { dataUrl?: string };

function formatDate(date: string) {
  return new Date(date).toLocaleString("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function revokeObjectUrls(urls: string[]) {
  urls.forEach((url) => {
    if (url.startsWith("blob:")) URL.revokeObjectURL(url);
  });
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
  const objectUrlsRef = useRef<string[]>([]);
  const [images, setImages] = useState<LoadedGeneratedImage[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<LoadedGeneratedImage | null>(null);

  const loadImages = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const saved = await getGeneratedImages(50);
      const nextObjectUrls: string[] = [];
      const hydrated = await Promise.all(saved.map(async (image) => {
        try {
          const dataUrl = await getAssetObjectUrl(image.id);
          nextObjectUrls.push(dataUrl);
          return { ...image, dataUrl };
        } catch {
          return image;
        }
      }));
      revokeObjectUrls(objectUrlsRef.current);
      objectUrlsRef.current = nextObjectUrls;
      setImages(hydrated);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "历史作品读取失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadImages();
    return () => {
      revokeObjectUrls(objectUrlsRef.current);
      objectUrlsRef.current = [];
    };
  }, [loadImages]);

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

  const downloadName = (image: LoadedGeneratedImage) =>
    `huacai-${image.templateTitle || image.ratio}-${image.id}`.replace(/[\\/:*?"<>|]/g, "-");

  const downloadImage = (image: LoadedGeneratedImage) => {
    if (!image.dataUrl) {
      notify("图片文件暂时不可下载，请刷新后重试");
    }
  };

  const reusePrompt = (image: LoadedGeneratedImage) => {
    onReusePrompt?.(image);
    setPreview(null);
  };

  return (
    <div className="generated-history-page">
      <section className="history-hero panel">
        <div>
          <span className="eyebrow">GENERATED HISTORY</span>
          <h2>历史生图作品</h2>
          <p>
            这里专门放 AI 生成后的成品图，适合美工复盘、运营选图和后续下载交付。
            当前账号：{currentUser.name} · {currentUser.role}
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
          <button className="secondary-button" type="button" onClick={() => void loadImages()}>
            刷新作品
          </button>
        </div>
      </section>

      <div className="template-results-head">
        <div><i />{loading ? "正在读取历史作品" : `${currentUser.role === "管理员" ? "团队" : "我的"} ${filteredImages.length} 张历史作品`}</div>
        <span>图片保存在团队素材库，可直接下载原图</span>
      </div>

      {error && <div className="ai-error" role="alert">! {error}</div>}

      {loading ? (
        <div className="ai-results-loading"><i className="spinner" />正在读取历史作品</div>
      ) : filteredImages.length ? (
        <section className="history-grid">
          {filteredImages.map((image) => (
            <article className="history-card" key={image.id}>
              <button className="history-card-image" type="button" onClick={() => setPreview(image)}>
                {image.dataUrl ? (
                  <img src={image.dataUrl} alt={image.templateTitle || "AI 生成作品"} loading="lazy" />
                ) : (
                  <div className="ai-result-missing">图片文件暂不可用</div>
                )}
              </button>
              <div className="history-card-body">
                <div className="history-card-head">
                  <span>
                    <b>{image.templateTitle || `${image.ratio} 商品图`}</b>
                    <small>{image.ownerName} · {formatDate(image.createdAt)} · {image.size}</small>
                  </span>
                  <div className="history-card-actions">
                    <button type="button" onClick={() => reusePrompt(image)}>复用提示词</button>
                    <button type="button" onClick={() => setPreview(image)}>大图</button>
                    {image.dataUrl ? (
                      <a href={image.dataUrl} download={downloadName(image)}>下载 ↓</a>
                    ) : (
                      <button type="button" onClick={() => downloadImage(image)}>下载</button>
                    )}
                  </div>
                </div>
                <p className="history-prompt">{image.prompt}</p>
              </div>
            </article>
          ))}
        </section>
      ) : (
        <section className="panel history-empty">
          <span>▣</span>
          <h3>暂时没有可见的历史作品</h3>
          <p>去素材库生成一批图后，这里会自动沉淀成大图作品库。</p>
        </section>
      )}

      {preview && (
        <div className="modal-backdrop" onMouseDown={() => setPreview(null)}>
          <section className="modal history-preview-modal" onMouseDown={(event) => event.stopPropagation()}>
            <div className="history-preview-image">
              {preview.dataUrl ? (
                <img src={preview.dataUrl} alt={preview.templateTitle || "AI 生成作品预览"} />
              ) : (
                <div className="ai-result-missing">图片文件暂不可用</div>
              )}
            </div>
            <aside>
              <button className="history-preview-close" type="button" onClick={() => setPreview(null)}>×</button>
              <span className="eyebrow">IMAGE DETAIL</span>
              <h3>{preview.templateTitle || `${preview.ratio} 商品图`}</h3>
              <dl>
                <div><dt>创建人</dt><dd>{preview.ownerName}</dd></div>
                <div><dt>生成时间</dt><dd>{formatDate(preview.createdAt)}</dd></div>
                <div><dt>尺寸</dt><dd>{preview.size}</dd></div>
                <div><dt>模型</dt><dd>{preview.model}</dd></div>
              </dl>
              <p>{preview.prompt}</p>
              {preview.dataUrl && (
                <a className="primary-button" href={preview.dataUrl} download={downloadName(preview)}>
                  下载原图 <span>↓</span>
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
