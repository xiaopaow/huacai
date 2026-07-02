import { useEffect, useMemo, useRef, useState } from "react";
import { inspirationTemplates, type InspirationTemplate } from "../data/templates";
import {
  deleteAsset,
  deleteAssets,
  createImageJob,
  deleteImageJob,
  getAiStatus,
  getAssetObjectUrl,
  getGeneratedImages,
  getImageJobs,
  retryImageJob,
  uploadTaskImages,
  type GeneratedImage,
  type ImageGenerationJob,
} from "../lib/api";
import type { EmployeeAccount } from "../types/domain";

type Filter = "全部" | string;
type Ratio = "1:1" | "16:9" | "3:4";
type Quality = "low" | "medium" | "high";

function loadStudioDraft(employeeId: string): { prompt: string; ratio: Ratio; quality: Quality } {
  try {
    const saved = JSON.parse(localStorage.getItem(`huacai-studio-draft:${employeeId}`) ?? "{}") as {
      prompt?: string;
      ratio?: Ratio;
      quality?: Quality;
    };
    return {
      prompt: saved.prompt ?? "",
      ratio: ["1:1", "16:9", "3:4"].includes(saved.ratio ?? "") ? saved.ratio! : "1:1",
      quality: ["low", "medium", "high"].includes(saved.quality ?? "") ? saved.quality! : "medium",
    };
  } catch {
    return { prompt: "", ratio: "1:1", quality: "medium" };
  }
}

export default function AssetsPage({ notify, currentUser }: { notify: (message: string) => void; currentUser: EmployeeAccount }) {
  const [initialDraft] = useState(() => loadStudioDraft(currentUser.id));
  const studioRef = useRef<HTMLElement>(null);
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const persistedUrlsRef = useRef<string[]>([]);
  const hydratedJobIdsRef = useRef<Set<string>>(new Set());
  const knownAssetIdsRef = useRef<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [type, setType] = useState<Filter>("全部");
  const [category, setCategory] = useState<Filter>("全部");
  const [layout, setLayout] = useState<Filter>("全部");
  const [selected, setSelected] = useState<InspirationTemplate | null>(null);
  const [appliedTemplate, setAppliedTemplate] = useState<InspirationTemplate | null>(null);
  const [prompt, setPrompt] = useState(initialDraft.prompt);
  const [ratio, setRatio] = useState<Ratio>(initialDraft.ratio);
  const [quality, setQuality] = useState<Quality>(initialDraft.quality);
  const [referenceFiles, setReferenceFiles] = useState<File[]>([]);
  const [referencePreviews, setReferencePreviews] = useState<string[]>([]);
  const [generating, setGenerating] = useState(false);
  const [loadingResults, setLoadingResults] = useState(true);
  const [results, setResults] = useState<GeneratedImage[]>([]);
  const [imageJobs, setImageJobs] = useState<ImageGenerationJob[]>([]);
  const [aiStatus, setAiStatus] = useState<Awaited<ReturnType<typeof getAiStatus>> | null>(null);
  const [deleteCandidate, setDeleteCandidate] = useState<GeneratedImage | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");
  const [favorites, setFavorites] = useState<Set<string>>(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem("huacai-template-favorites") ?? "[]") as string[]);
    } catch {
      return new Set();
    }
  });

  useEffect(() => {
    const urls = referenceFiles.map((file) => URL.createObjectURL(file));
    setReferencePreviews(urls);
    return () => urls.forEach(URL.revokeObjectURL);
  }, [referenceFiles]);

  useEffect(() => {
    let cancelled = false;
    const loadResults = async () => {
      try {
        const saved = await getGeneratedImages();
        const withPreviews = await Promise.all(saved.map(async (image) => {
          try {
            const dataUrl = await getAssetObjectUrl(image.id);
            persistedUrlsRef.current.push(dataUrl);
            return { ...image, dataUrl };
          } catch {
            return image;
          }
        }));
        if (!cancelled) {
          knownAssetIdsRef.current = new Set(withPreviews.map((image) => image.id));
          setResults(withPreviews);
        }
      } catch {
        // The studio remains usable even if an older asset cannot be loaded.
      } finally {
        if (!cancelled) setLoadingResults(false);
      }
    };
    void loadResults();
    return () => {
      cancelled = true;
      persistedUrlsRef.current.forEach(URL.revokeObjectURL);
      persistedUrlsRef.current = [];
    };
  }, []);

  useEffect(() => {
    getAiStatus().then(setAiStatus).catch(() => setAiStatus(null));
  }, []);

  useEffect(() => {
    localStorage.setItem(
      `huacai-studio-draft:${currentUser.id}`,
      JSON.stringify({ prompt, ratio, quality }),
    );
  }, [currentUser.id, prompt, ratio, quality]);

  useEffect(() => {
    let cancelled = false;
    let timer = 0;
    const pollJobs = async () => {
      let jobs: ImageGenerationJob[] = [];
      try {
        jobs = await getImageJobs();
        if (cancelled) return;
        setImageJobs(jobs);
        const billingFailure = jobs.find((job) => job.errorCode === "billing_hard_limit_reached");
        if (billingFailure) {
          setAiStatus((current) => current ? {
            ...current,
            lastFailure: { code: billingFailure.errorCode!, at: billingFailure.updatedAt },
          } : current);
        }
        for (const job of jobs) {
          if (
            job.status !== "succeeded"
            || !job.result
            || hydratedJobIdsRef.current.has(job.id)
            || knownAssetIdsRef.current.has(job.result.id)
          ) continue;
          hydratedJobIdsRef.current.add(job.id);
          try {
            const dataUrl = await getAssetObjectUrl(job.result.id);
            if (cancelled) {
              URL.revokeObjectURL(dataUrl);
              return;
            }
            persistedUrlsRef.current.push(dataUrl);
            knownAssetIdsRef.current.add(job.result.id);
            setResults((current) => [{ ...job.result!, dataUrl }, ...current].slice(0, 24));
            setAiStatus((current) => current ? { ...current, lastFailure: null } : current);
            notify("后台图片任务已完成，作品已进入素材库");
          } catch {
            hydratedJobIdsRef.current.delete(job.id);
          }
        }
      } catch {
        // Polling will retry without interrupting the current editor state.
      } finally {
        if (!cancelled) {
          const hasActive = jobs.some((job) => job.status === "queued" || job.status === "running");
          timer = window.setTimeout(pollJobs, hasActive ? 2000 : 10000);
        }
      }
    };
    void pollJobs();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, []);

  const filtered = useMemo(() => inspirationTemplates.filter((template) => {
    const keyword = `${template.title}${template.type}${template.category}${template.prompt}`.toLowerCase();
    return keyword.includes(query.trim().toLowerCase())
      && (type === "全部" || template.type === type)
      && (category === "全部" || template.category === category)
      && (layout === "全部" || template.layout === layout);
  }), [query, type, category, layout]);

  const toggleFavorite = (id: string) => {
    setFavorites((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      localStorage.setItem("huacai-template-favorites", JSON.stringify([...next]));
      return next;
    });
  };

  const applyTemplate = (template: InspirationTemplate) => {
    setAppliedTemplate(template);
    setPrompt(template.prompt);
    setRatio(template.aspectRatio);
    setSelected(null);
    setError("");
    window.setTimeout(() => {
      studioRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      promptRef.current?.focus({ preventScroll: true });
      promptRef.current?.setSelectionRange(template.prompt.length, template.prompt.length);
    }, 40);
  };

  const addReferenceFiles = (files: FileList | null) => {
    if (!files) return;
    const accepted = [...files].filter((file) => ["image/jpeg", "image/png", "image/webp"].includes(file.type));
    setReferenceFiles((current) => [...current, ...accepted].slice(0, 4));
    if (accepted.length !== files.length) notify("已忽略不支持的文件，仅支持 JPG、PNG、WEBP");
  };

  const createImage = async () => {
    if (!prompt.trim()) {
      setError("先写一句你想生成什么，或从下方选择一个模板。");
      studioRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    setGenerating(true);
    setError("");
    let uploadedAssetIds: string[] = [];
    let jobAccepted = false;
    try {
      const uploaded = referenceFiles.length
        ? await uploadTaskImages(`studio-${Date.now()}`, "", referenceFiles)
        : [];
      uploadedAssetIds = uploaded.map((asset) => asset.id);
      const job = await createImageJob({
        prompt: prompt.trim(),
        ratio,
        quality,
        referenceAssetIds: uploadedAssetIds,
        templateId: appliedTemplate?.id,
        templateTitle: appliedTemplate?.title,
      });
      jobAccepted = true;
      setImageJobs((current) => [job, ...current.filter((item) => item.id !== job.id)]);
      setReferenceFiles([]);
      notify("生成任务已提交到后台，可以继续浏览或离开页面");
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "图片生成失败，请稍后重试";
      setError(message);
      if (message.includes("额度")) {
        setAiStatus((current) => current ? {
          ...current,
          lastFailure: { code: "billing_hard_limit_reached", at: new Date().toISOString() },
        } : current);
      }
    } finally {
      if (!jobAccepted && uploadedAssetIds.length) await deleteAssets(uploadedAssetIds);
      setGenerating(false);
    }
  };

  const retryJob = async (job: ImageGenerationJob) => {
    try {
      const updated = await retryImageJob(job.id);
      setImageJobs((current) => current.map((item) => item.id === updated.id ? updated : item));
      notify("任务已重新进入生成队列");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "任务重试失败");
    }
  };

  const loadJobForEditing = (job: ImageGenerationJob) => {
    const template = job.templateId
      ? inspirationTemplates.find((item) => item.id === job.templateId) ?? null
      : null;
    setAppliedTemplate(template);
    setPrompt(job.prompt);
    setRatio(job.ratio as Ratio);
    setQuality(job.quality as Quality);
    setError("");
    window.setTimeout(() => {
      studioRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      promptRef.current?.focus({ preventScroll: true });
      promptRef.current?.setSelectionRange(job.prompt.length, job.prompt.length);
    }, 40);
    notify("失败任务已载入创作台，可修改后重新生成");
  };

  const dismissJob = async (job: ImageGenerationJob) => {
    try {
      await deleteImageJob(job.id);
      setImageJobs((current) => current.filter((item) => item.id !== job.id));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "任务记录移除失败");
    }
  };

  const removeGeneratedImage = async () => {
    if (!deleteCandidate || deleting) return;
    setDeleting(true);
    try {
      await deleteAsset(deleteCandidate.id);
      if (deleteCandidate.dataUrl?.startsWith("blob:")) URL.revokeObjectURL(deleteCandidate.dataUrl);
      setResults((current) => current.filter((image) => image.id !== deleteCandidate.id));
      setDeleteCandidate(null);
      notify("作品已从素材库删除");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "作品删除失败");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="template-library">
      <section className="ai-studio panel" ref={studioRef}>
        <div className="ai-studio-head">
          <div>
            <span className="eyebrow">HUACAI IMAGE STUDIO</span>
            <h2>一句话，直接生成商品图</h2>
            <p>选择模板会自动带入提示词；上传商品原图后，AI 会尽量保留产品外观。</p>
          </div>
          <span className={`ai-model-badge ${aiStatus?.lastFailure?.code === "billing_hard_limit_reached" ? "warning" : ""}`}>
            <i /> {aiStatus?.lastFailure?.code === "billing_hard_limit_reached" ? "额度待处理" : aiStatus?.configured ? aiStatus.model : "AI 未配置"}
          </span>
        </div>

        <div className="ai-compose">
          <div className="ai-prompt-area">
            {appliedTemplate && (
              <div className="applied-template-chip">
                <img src={appliedTemplate.imageUrl} alt="" />
                <span><small>正在参考</small><b>{appliedTemplate.title}</b></span>
                <button type="button" onClick={() => setAppliedTemplate(null)} aria-label="移除模板">×</button>
              </div>
            )}
            <textarea
              ref={promptRef}
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              onKeyDown={(event) => {
                if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
                  event.preventDefault();
                  void createImage();
                }
              }}
              maxLength={4000}
              placeholder="例如：把参考商品放在明亮的北欧客厅中，窗边自然光，真实摄影质感，无文字，适合 Amazon 场景图……"
            />
            <div className="ai-prompt-foot">
              <span>{prompt.length} / 4000 · 草稿已自动保存 · Ctrl/⌘ + Enter 生成</span>
              <button type="button" onClick={() => setPrompt("")}>清空</button>
            </div>
          </div>

          <div className="ai-reference">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              multiple
              onChange={(event) => {
                addReferenceFiles(event.target.files);
                event.currentTarget.value = "";
              }}
            />
            <div className="ai-reference-list">
              {referencePreviews.map((url, index) => (
                <div className="ai-reference-thumb" key={url}>
                  <img src={url} alt={`参考图 ${index + 1}`} />
                  <button type="button" onClick={() => setReferenceFiles((current) => current.filter((_, fileIndex) => fileIndex !== index))}>×</button>
                </div>
              ))}
              {referenceFiles.length < 4 && (
                <button className="ai-reference-add" type="button" onClick={() => fileInputRef.current?.click()}>
                  <span>＋</span><b>商品参考图</b><small>最多 4 张</small>
                </button>
              )}
            </div>
          </div>
        </div>

        <div className="ai-controls">
          <label><span>画面比例</span><select value={ratio} onChange={(event) => setRatio(event.target.value as Ratio)}><option value="1:1">1:1 方图</option><option value="16:9">16:9 横图</option><option value="3:4">3:4 竖图</option></select></label>
          <label><span>生成质量</span><select value={quality} onChange={(event) => setQuality(event.target.value as Quality)}><option value="low">快速草图</option><option value="medium">标准出图</option><option value="high">高清成品</option></select></label>
          <div className="ai-count"><span>生成数量</span><b>1 张</b></div>
          <button className="ai-generate-button" type="button" disabled={generating} onClick={createImage}>
            {generating ? <><i className="spinner" />正在提交后台任务</> : <>一键生成图片 <span>↗</span></>}
          </button>
        </div>
        {error && <div className="ai-error">! {error}</div>}
      </section>

      {imageJobs.length > 0 && (
        <section className="ai-job-panel panel">
          <div className="ai-job-head">
            <div><span className="eyebrow">BACKGROUND JOBS</span><h3>生成任务</h3></div>
            <span>刷新或离开页面不会中断</span>
          </div>
          <div className="ai-job-list">
            {imageJobs.slice(0, 6).map((job) => (
              <article key={job.id}>
                <span className={`ai-job-state ${job.status}`}>
                  {job.status === "queued" && job.nextRetryAt ? "自动重试" : job.status === "queued" ? "排队中" : job.status === "running" ? "生成中" : job.status === "succeeded" ? "已完成" : "失败"}
                </span>
                <div>
                  <b>{job.templateTitle || `${job.ratio} 商品图`}</b>
                  <small>{job.prompt}</small>
                  {(job.status === "queued" || job.status === "running") && <div className="ai-job-progress"><i style={{ width: `${job.progress}%` }} /></div>}
                  {job.errorMessage && <em>{job.errorMessage}</em>}
                </div>
                <time>{new Date(job.updatedAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}</time>
                {(job.status === "failed" || job.status === "succeeded") && (
                  <div className="ai-job-actions">
                    {job.status === "failed" && <button className="edit" onClick={() => loadJobForEditing(job)}>载入修改</button>}
                    {job.status === "failed" && job.attempts < 3 && <button onClick={() => retryJob(job)}>重试</button>}
                    <button className="quiet" onClick={() => dismissJob(job)}>移除</button>
                  </div>
                )}
              </article>
            ))}
          </div>
        </section>
      )}

      {(loadingResults || results.length > 0) && (
        <section className="ai-results">
          <div className="template-results-head"><div><i />团队生成作品</div><span>结果永久保存在素材库，刷新页面也不会丢失</span></div>
          {loadingResults ? <div className="ai-results-loading"><i className="spinner" />正在读取历史作品</div> : (
            <div className="ai-result-grid">
              {results.map((image) => (
              <article className="ai-result-card" key={image.id}>
                {image.dataUrl ? <img src={image.dataUrl} alt={image.templateTitle || "AI 生成结果"} /> : <div className="ai-result-missing">图片文件暂不可用</div>}
                <div>
                  <span><b>{image.templateTitle || `${image.ratio} 商品图`}</b><small>{image.ownerName} · {new Date(image.createdAt).toLocaleDateString("zh-CN")} · {image.size}</small></span>
                  <div className="ai-result-actions">
                    {image.dataUrl && <a href={image.dataUrl} download={`huacai-${image.id}`}>下载 ↓</a>}
                    {(currentUser.role === "管理员" || image.ownerId === currentUser.id) && <button onClick={() => setDeleteCandidate(image)}>删除</button>}
                  </div>
                </div>
              </article>
              ))}
            </div>
          )}
        </section>
      )}

      <section className="template-intro">
        <div>
          <span className="eyebrow">AMAZON CREATIVE TEMPLATES</span>
          <h2>从灵感模板开始创作</h2>
          <p>点击“做同款”，提示词会直接进入上方创作台，不再跳转新建任务。</p>
        </div>
        <label className="template-search"><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索模板、品类或场景" /></label>
      </section>

      <section className="template-filters panel">
        <FilterRow label="类型" value={type} setValue={setType} options={["全部", "卖点图", "场景图", "尺寸图", "细节图", "白底图"]} />
        <FilterRow label="品类" value={category} setValue={setCategory} options={["全部", "日用百货", "家居家装"]} />
        <FilterRow label="版式" value={layout} setValue={setLayout} options={["全部", "方形", "横版", "竖版"]} />
      </section>

      <div className="template-results-head">
        <div><i />共 {filtered.length} 个灵感模板</div>
        <span>悬停模板可直接做同款</span>
      </div>

      {filtered.length ? (
        <section className="template-masonry">
          {filtered.map((template) => (
            <article className="template-card" key={template.id}>
              <div className={`template-cover ratio-${template.layout}`}>
                <img src={template.imageUrl} alt={template.title} loading="lazy" onError={(event) => { event.currentTarget.style.display = "none"; }} />
                <span className="template-type">{template.type}</span>
                <button className={`template-favorite ${favorites.has(template.id) ? "active" : ""}`} onClick={() => toggleFavorite(template.id)} aria-label={`${favorites.has(template.id) ? "取消收藏" : "收藏"} ${template.title}`}>{favorites.has(template.id) ? "♥" : "♡"}</button>
                <div className="template-hover">
                  <button onClick={() => applyTemplate(template)}>✦ 做同款</button>
                  <button onClick={() => setSelected(template)}>查看详情</button>
                </div>
              </div>
              <div className="template-meta">
                <div><h3>{template.title}</h3><p>{template.category} · {template.layout} {template.aspectRatio}</p></div>
                <button onClick={() => setSelected(template)} aria-label={`查看 ${template.title}`}>→</button>
              </div>
            </article>
          ))}
        </section>
      ) : (
        <div className="panel template-empty"><span>⌕</span><h3>没有匹配的模板</h3><p>试试调整类型、品类、版式或搜索词。</p></div>
      )}

      {selected && (
        <div className="modal-backdrop" onMouseDown={() => setSelected(null)}>
          <section className="modal template-detail" onMouseDown={(event) => event.stopPropagation()}>
            <div className="modal-head"><div><span className="eyebrow">TEMPLATE DETAILS</span><h3>{selected.title}</h3></div><button onClick={() => setSelected(null)}>×</button></div>
            <div className="template-detail-grid">
              <img src={selected.imageUrl} alt={selected.title} />
              <div>
                <div className="template-tags"><span>{selected.type}</span><span>{selected.category}</span><span>{selected.layout} {selected.aspectRatio}</span></div>
                <b>模板提示词</b>
                <p>{selected.prompt}</p>
                <button className="primary-button" onClick={() => applyTemplate(selected)}>使用此模板<span>→</span></button>
              </div>
            </div>
          </section>
        </div>
      )}

      {deleteCandidate && (
        <div className="modal-backdrop" onMouseDown={() => !deleting && setDeleteCandidate(null)}>
          <section className="modal asset-delete-dialog" onMouseDown={(event) => event.stopPropagation()}>
            <div className="logout-icon">⌫</div>
            <span className="eyebrow">DELETE ASSET</span>
            <h3>删除这张生成作品？</h3>
            <p>图片文件和素材记录都会永久删除，此操作无法撤销。</p>
            <div className="modal-actions">
              <button className="secondary-button" disabled={deleting} onClick={() => setDeleteCandidate(null)}>取消</button>
              <button className="danger-button" disabled={deleting} onClick={removeGeneratedImage}>{deleting ? "正在删除…" : "确认删除"}</button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

function FilterRow({ label, value, setValue, options }: { label: string; value: Filter; setValue: (value: Filter) => void; options: string[] }) {
  return (
    <div className="template-filter-row">
      <b>{label}</b>
      <div>{options.map((option) => <button className={value === option ? "active" : ""} onClick={() => setValue(option)} key={option}>{option}</button>)}</div>
    </div>
  );
}
