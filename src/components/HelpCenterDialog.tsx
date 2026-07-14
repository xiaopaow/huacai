import { useEffect, useRef } from "react";
import type { EmployeeAccount, PageKey } from "../types/domain";

interface HelpCenterDialogProps {
  role: EmployeeAccount["role"];
  onClose: () => void;
  onNavigate: (page: PageKey) => void;
}

const roleGuides: Record<EmployeeAccount["role"], Array<[string, string]>> = {
  "管理员": [
    ["初始化公司数据", "先到 SKU 商品库导入真实商品，再在系统设置创建员工账号。"],
    ["保障数据安全", "重大批量操作前手动备份；系统也会每天自动保留快照。"],
    ["配置外部服务", "AI 生图和 Amazon SP-API 凭据由服务器环境变量统一管理。"],
  ],
  "运营": [
    ["维护商品资料", "在 SKU 商品库录入或批量导入 SKU、ASIN、品牌、类目和站点。"],
    ["创建并派发任务", "上传商品原图，选择任务类型、负责人和截止日期。"],
    ["准备 Listing", "在 Listing 中心检查标题、五点、关键词并执行提交前验证。"],
  ],
  "设计": [
    ["处理分配任务", "从通知或任务中心打开任务，确认原图、截止日期和修改意见。"],
    ["提交设计成品", "任务详情支持上传 V1、V2 等版本，提交后自动进入审核中心。"],
    ["使用 AI 创作", "素材库可从模板带入提示词，上传商品参考图后直接生成。"],
  ],
  "审核": [
    ["定位待审核任务", "点击站内通知会直接定位并高亮对应审核卡片。"],
    ["写清修改意见", "驳回必须填写具体修改要求；通过时可附加交付说明。"],
    ["查看版本记录", "任务详情保留每一版审核结论、意见和审核时间。"],
  ],
};

const quickLinks: Record<EmployeeAccount["role"], Array<[PageKey, string, string]>> = {
  "管理员": [["products", "SKU 商品库", "导入和维护公司商品"], ["settings", "系统设置", "员工、备份与安全"], ["performance", "员工效率", "查看团队流程数据"]],
  "运营": [["products", "SKU 商品库", "维护商品主数据"], ["create", "新建任务", "上传原图并派单"], ["listings", "Listing 中心", "编辑并检查 Listing"]],
  "设计": [["tasks", "任务中心", "处理设计任务"], ["assets", "素材库", "模板与 AI 创作"]],
  "审核": [["reviews", "审核中心", "处理待审核作品"], ["tasks", "任务中心", "查看版本和结果"]],
};

export default function HelpCenterDialog({ role, onClose, onNavigate }: HelpCenterDialogProps) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const focusTimer = window.requestAnimationFrame(() => closeRef.current?.focus());
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.cancelAnimationFrame(focusTimer);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [onClose]);

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <section className="modal help-center-dialog" role="dialog" aria-modal="true" aria-labelledby="help-center-title" onMouseDown={(event) => event.stopPropagation()}>
        <div className="modal-head">
          <div><span className="eyebrow">HUACAI HELP CENTER</span><h3 id="help-center-title">{role}使用指南</h3></div>
          <button ref={closeRef} type="button" aria-label="关闭帮助中心" onClick={onClose}>×</button>
        </div>
        <div className="help-guide-list">
          {roleGuides[role].map(([title, description], index) => (
            <article key={title}><i>{index + 1}</i><div><b>{title}</b><p>{description}</p></div></article>
          ))}
        </div>
        <div className="help-section-head"><b>常用入口</b><span>根据当前账号权限显示</span></div>
        <div className="help-quick-links">
          {quickLinks[role].map(([page, title, description]) => (
            <button type="button" key={page} onClick={() => onNavigate(page)}>
              <span><b>{title}</b><small>{description}</small></span><i>→</i>
            </button>
          ))}
        </div>
        <div className="help-tips">
          <div><b>图片要求</b><span>JPG / PNG / WEBP，单张不超过 20MB</span></div>
          <div><b>AI 快捷键</b><span>创作台按 Ctrl / ⌘ + Enter 提交生成</span></div>
          <div><b>数据安全</b><span>业务数据和图片保存在服务器，不依赖员工浏览器</span></div>
        </div>
      </section>
    </div>
  );
}
