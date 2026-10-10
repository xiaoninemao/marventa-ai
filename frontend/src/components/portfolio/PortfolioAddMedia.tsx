"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useDropdownMenu } from "@/hooks/use_dropdown_menu";
import { useI18n } from "@/contexts/i18n_context";
import { GuardedButton } from "@/components/redesign/GuardedControls";
import InlineIcon from "@/components/redesign/InlineIcon";

export default function PortfolioAddMedia({ index, disabled, onChoose, video = false }: {
  index: number;
  disabled: boolean;
  video?: boolean;
  onChoose: (source: "materials" | "upload", index: number) => void;
}) {
  const { t } = useI18n();
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);
  useEffect(() => { setPortalTarget(document.body); }, []);
  const { open, position, triggerRef, menuRef, menuId, toggleMenu, closeMenu,
    handleTriggerKeyDown, handleMenuKeyDown } = useDropdownMenu(2, "start");
  const label = video ? t("添加视频", "Add video")
    : t("在第 {count} 个位置添加图片", "Add images at position {count}", { count: index + 1 });
  const choose = (source: "materials" | "upload") => {
    closeMenu();
    onChoose(source, index);
  };
  return <>
    <GuardedButton ref={triggerRef} type="button" className="amp-portfolio-add-trigger"
      aria-label={label} aria-haspopup="menu" aria-expanded={open} aria-controls={open ? menuId : undefined}
      disabled={disabled} blockedReason={t("正在保存作品，请稍候", "Work is being saved. Please wait.")}
      onClick={() => toggleMenu()} onKeyDown={event => { if (!disabled) handleTriggerKeyDown(event); }}>
      <InlineIcon name="plus" strokeWidth={1.75} />
    </GuardedButton>
    {open && portalTarget && createPortal(
      <div id={menuId} ref={menuRef} role="menu" aria-label={label}
        className="amp-enterprise-select-menu amp-portfolio-add-menu"
        style={{ top: position.top, left: position.left }} onKeyDown={handleMenuKeyDown}>
        <GuardedButton type="button" role="menuitem" className="amp-portfolio-add-option" disabled={disabled}
          blockedReason={t("正在保存作品，请稍候", "Work is being saved. Please wait.")}
          onClick={() => choose("materials")}><InlineIcon name="collection" /><span>{t("从素材集选择", "Materials")}</span></GuardedButton>
        <GuardedButton type="button" role="menuitem" className="amp-portfolio-add-option" disabled={disabled}
          blockedReason={t("正在保存作品，请稍候", "Work is being saved. Please wait.")}
          onClick={() => choose("upload")}><InlineIcon name="upload" /><span>{t("本地上传", "Upload")}</span></GuardedButton>
      </div>, portalTarget,
    )}
  </>;
}
