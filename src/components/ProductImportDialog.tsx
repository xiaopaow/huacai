import { useRef, useState } from "react";
import {
  downloadProductImportTemplate,
  readProductImportFile,
  type ProductImportPreviewRow,
} from "../lib/productImport";
import type { Product } from "../types/domain";

interface ProductImportDialogProps {
  existingSkus: string[];
  onClose: () => void;
  onImport: (products: Product[]) => Promise<number>;
}

export default function ProductImportDialog({ existingSkus, onClose, onImport }: ProductImportDialogProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState("");
  const [rows, setRows] = useState<ProductImportPreviewRow[]>([]);
  const [error, setError] = useState("");
  const [parsing, setParsing] = useState(false);
  const [importing, setImporting] = useState(false);
  const validRows = rows.filter((row) => row.issues.length === 0);
  const invalidRows = rows.filter((row) => row.issues.length > 0);

  const chooseFile = async (file?: File) => {
    if (!file) return;
    setParsing(true);
    setError("");
    setRows([]);
    setFileName(file.name);
    try {
      const preview = await readProductImportFile(file, existingSkus);
      setRows(preview.rows);
      setError(preview.error ?? "");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "表格读取失败，请检查文件格式");
    } finally {
      setParsing(false);
    }
  };

  const submit = async () => {
    if (!validRows.length || importing) return;
    setImporting(true);
    setError("");
    try {
      const count = await onImport(validRows.map((row) => row.product));
      if (count > 0) onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "SKU 导入失败");
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="modal-backdrop" onMouseDown={() => !importing && onClose()}>
      <section className="modal product-import-dialog" role="dialog" aria-modal="true" aria-labelledby="product-import-title" onMouseDown={(event) => event.stopPropagation()}>
        <div className="modal-head">
          <div><span className="eyebrow">BULK IMPORT</span><h3 id="product-import-title">批量导入公司 SKU</h3></div>
          <button type="button" aria-label="关闭" disabled={importing} onClick={onClose}>×</button>
        </div>
        <div className="import-guide">
          <span>1</span><p><b>下载模板并填写</b><small>SKU、商品名称、品牌为必填列；支持美国、英国、德国、日本站。</small></p>
          <button type="button" className="text-button" onClick={downloadProductImportTemplate}>下载 CSV 模板</button>
        </div>
        <div className="import-guide">
          <span>2</span><p><b>上传 Excel 或 CSV</b><small>支持 .xlsx、.csv、.tsv，单次最多导入 500 个 SKU。</small></p>
          <button type="button" className="secondary-button" disabled={parsing || importing} onClick={() => inputRef.current?.click()}>{parsing ? "正在读取…" : fileName || "选择文件"}</button>
          <input
            ref={inputRef}
            className="visually-hidden"
            type="file"
            accept=".xlsx,.csv,.tsv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv,text/tab-separated-values"
            onChange={(event) => {
              void chooseFile(event.target.files?.[0]);
              event.currentTarget.value = "";
            }}
          />
        </div>
        {error && <div className="import-error" role="alert">! {error}</div>}
        {rows.length > 0 && (
          <>
            <div className="import-summary">
              <b>{fileName}</b>
              <span className="valid">可导入 {validRows.length}</span>
              <span className={invalidRows.length ? "invalid" : ""}>需修正 {invalidRows.length}</span>
            </div>
            <div className="import-preview">
              <div className="import-preview-row header"><span>行</span><span>SKU / 商品</span><span>品牌 / 站点</span><span>检查结果</span></div>
              {rows.slice(0, 12).map((row) => (
                <div className={`import-preview-row ${row.issues.length ? "has-error" : ""}`} key={row.rowNumber}>
                  <span>{row.rowNumber}</span>
                  <span><b>{row.product.sku || "—"}</b><small>{row.product.name || "未填写"}</small></span>
                  <span><b>{row.product.brand || "—"}</b><small>{row.product.marketplace}</small></span>
                  <span>{row.issues.length ? row.issues.join("；") : "✓ 可导入"}</span>
                </div>
              ))}
              {rows.length > 12 && <div className="import-more">还有 {rows.length - 12} 行未展开，导入时会全部处理。</div>}
            </div>
          </>
        )}
        <div className="modal-actions">
          <button type="button" className="secondary-button" disabled={importing} onClick={onClose}>取消</button>
          <button type="button" className="primary-button" disabled={!validRows.length || Boolean(error) || importing} onClick={submit}>
            {importing ? "正在写入共享商品库…" : `导入 ${validRows.length} 个有效 SKU`}
          </button>
        </div>
      </section>
    </div>
  );
}
