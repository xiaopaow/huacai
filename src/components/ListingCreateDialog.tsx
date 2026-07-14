import { useEffect, useMemo, useRef, useState } from "react";
import type { AmazonListing, Product } from "../types/domain";

export interface ListingMarketplaceOption {
  id: string;
  name: string;
  currency: string;
}

export const listingMarketplaces: ListingMarketplaceOption[] = [
  { id: "ATVPDKIKX0DER", name: "美国站", currency: "USD" },
  { id: "A1F83G8C2ARO7P", name: "英国站", currency: "GBP" },
  { id: "A1PA6795UKMFR9", name: "德国站", currency: "EUR" },
  { id: "A1VC38T7YXB528", name: "日本站", currency: "JPY" },
];

function defaultMarketplace(product?: Product) {
  return listingMarketplaces.find((marketplace) => marketplace.name === product?.marketplace)?.id
    ?? listingMarketplaces[0].id;
}

interface ListingCreateDialogProps {
  products: Product[];
  listings: AmazonListing[];
  creating: boolean;
  onClose: () => void;
  onCreate: (product: Product, marketplace: ListingMarketplaceOption) => Promise<void>;
}

export default function ListingCreateDialog({
  products,
  listings,
  creating,
  onClose,
  onCreate,
}: ListingCreateDialogProps) {
  const [marketplaceId, setMarketplaceId] = useState(defaultMarketplace(products[0]));
  const [productId, setProductId] = useState(products[0]?.id ?? "");
  const [error, setError] = useState("");
  const cancelRef = useRef<HTMLButtonElement>(null);

  const existingKeys = useMemo(() => new Set(
    listings.map((listing) => `${listing.marketplaceId}:${listing.sku.trim().toUpperCase()}`),
  ), [listings]);
  const availableProducts = products.filter((product) => (
    !existingKeys.has(`${marketplaceId}:${product.sku.trim().toUpperCase()}`)
  ));
  const selectedProduct = products.find((product) => product.id === productId);
  const selectedMarketplace = listingMarketplaces.find((marketplace) => marketplace.id === marketplaceId)!;
  const selectedAlreadyExists = selectedProduct
    ? existingKeys.has(`${marketplaceId}:${selectedProduct.sku.trim().toUpperCase()}`)
    : false;

  useEffect(() => {
    const focusTimer = window.requestAnimationFrame(() => cancelRef.current?.focus());
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !creating) onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.cancelAnimationFrame(focusTimer);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [creating, onClose]);

  useEffect(() => {
    if (!selectedProduct || selectedAlreadyExists) setProductId(availableProducts[0]?.id ?? "");
  }, [marketplaceId, selectedAlreadyExists]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selectedProduct || selectedAlreadyExists || creating) return;
    setError("");
    try {
      await onCreate(selectedProduct, selectedMarketplace);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Listing 创建失败");
    }
  };

  return (
    <div className="modal-backdrop" onMouseDown={() => !creating && onClose()}>
      <form
        className="modal listing-create-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="listing-create-title"
        onSubmit={submit}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="modal-head">
          <div><span className="eyebrow">NEW AMAZON LISTING</span><h3 id="listing-create-title">从 SKU 创建 Listing</h3></div>
          <button type="button" aria-label="关闭" disabled={creating} onClick={onClose}>×</button>
        </div>
        <p className="listing-create-note">同一 SKU 在同一站点只保留一条 Listing，避免重复提交和数据冲突。</p>
        <label>目标站点
          <select value={marketplaceId} onChange={(event) => setMarketplaceId(event.target.value)}>
            {listingMarketplaces.map((marketplace) => (
              <option key={marketplace.id} value={marketplace.id}>{marketplace.name} · {marketplace.currency}</option>
            ))}
          </select>
        </label>
        <label>SKU 商品
          <select value={productId} onChange={(event) => setProductId(event.target.value)} disabled={!availableProducts.length}>
            {products.map((product) => {
              const exists = existingKeys.has(`${marketplaceId}:${product.sku.trim().toUpperCase()}`);
              return (
                <option key={product.id} value={product.id} disabled={exists}>
                  {product.sku} · {product.name}{exists ? "（已有 Listing）" : ""}
                </option>
              );
            })}
          </select>
        </label>
        {selectedProduct && !selectedAlreadyExists && (
          <div className="listing-create-preview">
            <span>{selectedProduct.name.slice(0, 1)}</span>
            <div><b>{selectedProduct.sku}</b><p>{selectedProduct.name}</p><small>{selectedProduct.brand} · {selectedProduct.category}</small></div>
          </div>
        )}
        {!availableProducts.length && (
          <div className="import-error" role="alert">当前站点的商品都已有 Listing，请直接编辑左侧原草稿。</div>
        )}
        {error && <div className="import-error" role="alert">! {error}</div>}
        <div className="modal-actions">
          <button ref={cancelRef} type="button" className="secondary-button" disabled={creating} onClick={onClose}>取消</button>
          <button className="primary-button" disabled={!selectedProduct || selectedAlreadyExists || creating}>
            {creating ? "正在创建…" : `创建 ${selectedMarketplace.name} Listing`}
          </button>
        </div>
      </form>
    </div>
  );
}
