import { useEffect, useRef } from "react";
import type { AmazonListing } from "../types/domain";

interface ListingDeleteDialogProps {
  listing: AmazonListing;
  deleting: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export default function ListingDeleteDialog({
  listing,
  deleting,
  onCancel,
  onConfirm,
}: ListingDeleteDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const blocked = listing.status === "提交中" || listing.status === "已发布";

  useEffect(() => {
    const focusTimer = window.requestAnimationFrame(() => cancelRef.current?.focus());
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !deleting) onCancel();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.cancelAnimationFrame(focusTimer);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [deleting, onCancel]);

  return (
    <div className="modal-backdrop" onMouseDown={() => !deleting && onCancel()}>
      <section
        className="modal listing-delete-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="listing-delete-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className={`product-delete-icon ${blocked ? "blocked" : ""}`}>{blocked ? "!" : "⌫"}</div>
        <span className="eyebrow">{blocked ? "AMAZON LISTING ACTIVE" : "DELETE LOCAL LISTING"}</span>
        <h3 id="listing-delete-title">{blocked ? "不能只删除本地记录" : "删除这条 Listing 草稿？"}</h3>
        <p><b>{listing.sku}</b> · {listing.marketplaceName} · {listing.productType || "未选类目"}</p>
        <div className={`product-delete-note ${blocked ? "blocked" : ""}`}>
          {blocked
            ? "该 Listing 已进入 Amazon 处理流程。需要下架时必须调用 Amazon 删除/下架流程，不能只清掉花彩记录。"
            : "只会删除花彩中的 Listing 草稿，不会删除 SKU 商品资料，也不会影响素材和生产任务。"}
        </div>
        <div className="modal-actions">
          <button ref={cancelRef} className="secondary-button" disabled={deleting} onClick={onCancel}>
            {blocked ? "返回 Listing" : "取消"}
          </button>
          {!blocked && (
            <button className="danger-button" disabled={deleting} onClick={onConfirm}>
              {deleting ? "正在删除…" : "确认删除草稿"}
            </button>
          )}
        </div>
      </section>
    </div>
  );
}
