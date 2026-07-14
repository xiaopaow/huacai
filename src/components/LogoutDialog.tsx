import { useEffect, useRef, type RefObject } from "react";
import type { EmployeeAccount } from "../types/domain";

interface LogoutDialogProps {
  currentUser: EmployeeAccount;
  activeImageJobs: number;
  signingOut: boolean;
  returnFocusRef: RefObject<HTMLButtonElement | null>;
  onCancel: () => void;
  onConfirm: () => void;
}

export default function LogoutDialog({
  currentUser,
  activeImageJobs,
  signingOut,
  returnFocusRef,
  onCancel,
  onConfirm,
}: LogoutDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const focusTimer = window.requestAnimationFrame(() => cancelRef.current?.focus());
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !signingOut) onCancel();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.cancelAnimationFrame(focusTimer);
      window.removeEventListener("keydown", closeOnEscape);
      if (document.contains(returnFocusRef.current)) returnFocusRef.current?.focus();
    };
  }, [onCancel, returnFocusRef, signingOut]);

  return (
    <div className="modal-backdrop" data-testid="logout-backdrop" onMouseDown={() => !signingOut && onCancel()}>
      <section
        className="modal logout-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="logout-title"
        aria-describedby="logout-description"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="logout-icon">↪</div>
        <span className="eyebrow">SIGN OUT</span>
        <h3 id="logout-title">确认退出花彩工作台？</h3>
        <p id="logout-description">你将退出 <b>{currentUser.name}</b>（@{currentUser.username}），下次使用需要重新输入账号密码。</p>
        <div className="logout-notes">
          <span><i>✓</i>创作台的提示词草稿会保留</span>
          <span><i>✓</i>{activeImageJobs ? `${activeImageJobs} 个后台生图任务会继续运行` : "已经提交的任务和素材不会丢失"}</span>
          <span className="warning"><i>!</i>尚未上传的本地图片需要重新选择</span>
        </div>
        <div className="modal-actions">
          <button ref={cancelRef} className="secondary-button" disabled={signingOut} onClick={onCancel}>留在工作台</button>
          <button className="danger-button" disabled={signingOut} onClick={onConfirm}>{signingOut ? "正在安全退出…" : "确认退出"}</button>
        </div>
      </section>
    </div>
  );
}
