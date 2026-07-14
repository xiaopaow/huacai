import { useEffect, useRef } from "react";
import type { Product } from "../types/domain";

interface ProductDeleteDialogProps {
  product: Product;
  relatedTaskCount: number;
  relatedListingCount: number;
  deleting: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export default function ProductDeleteDialog({
  product,
  relatedTaskCount,
  relatedListingCount,
  deleting,
  onCancel,
  onConfirm,
}: ProductDeleteDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const blocked = relatedTaskCount > 0 || relatedListingCount > 0;

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
        className="modal product-delete-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="product-delete-title"
        aria-describedby="product-delete-description"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className={`product-delete-icon ${blocked ? "blocked" : ""}`}>{blocked ? "!" : "⌫"}</div>
        <span className="eyebrow">{blocked ? "PRODUCT IN USE" : "DELETE PRODUCT"}</span>
        <h3 id="product-delete-title">{blocked ? "这个 SKU 暂时不能删除" : "确认删除这个 SKU？"}</h3>
        <p id="product-delete-description">
          <b>{product.sku}</b> · {product.name}
        </p>
        {blocked ? (
          <div className="product-delete-note blocked">
            {relatedTaskCount > 0 && <>该商品关联了 {relatedTaskCount} 个生产任务。为保留审核记录和作品来源，请先处理关联任务。 </>}
            {relatedListingCount > 0 && <>该商品关联了 {relatedListingCount} 条 Amazon Listing。为避免 Listing 草稿或提交记录失去 SKU 来源，请先处理关联 Listing。</>}
          </div>
        ) : (
          <div className="product-delete-note">
            商品资料将从共享工作区永久删除，此操作无法撤销。
          </div>
        )}
        <div className="modal-actions">
          <button ref={cancelRef} className="secondary-button" disabled={deleting} onClick={onCancel}>
            {blocked ? "返回商品库" : "取消"}
          </button>
          {!blocked && (
            <button className="danger-button" disabled={deleting} onClick={onConfirm}>
              {deleting ? "正在删除…" : `确认删除 ${product.sku}`}
            </button>
          )}
        </div>
      </section>
    </div>
  );
}
