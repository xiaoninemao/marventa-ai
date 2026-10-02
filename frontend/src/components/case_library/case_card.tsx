"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import type { CaseItem } from "@/types/case_library";
import { useI18n } from "@/contexts/i18n_context";
import type { Translate } from "@/i18n/locale";
import { ENGLISH_ACTIONS, CHINESE_ACTIONS } from "@/i18n/interaction_copy";
import InlineIcon from "@/components/redesign/InlineIcon";
import { GuardedButton } from "@/components/redesign/GuardedControls";
import { API_BASE } from "@/services/api_core";

function contentTypeLabel(type: CaseItem["content_type"], t: Translate): string {
  if (type === "video") return t("视频", "Video");
  if (type === "image_text") return t("图文", "Image post");
  return t("待确认", "Unconfirmed");
}

function mediaUrl(value: string | undefined): string {
  if (!value) return "";
  if (value.startsWith("http")) return value;
  if (value.startsWith("/media/")) return `${API_BASE}${value}`;
  if (value.startsWith("/")) return value;
  return `${API_BASE}/media/${value}`;
}

export default function CaseCard({
  item,
  is_favorited = false,
  canDelete = false,
  onFavorite,
  onDelete,
  onOpen,
  selectionMode = false,
  selected = false,
  staticMedia = false,
  showSelectionIndicator = true,
}: {
  item: CaseItem;
  is_favorited?: boolean;
  canDelete?: boolean;
  onFavorite?: (id: string, currently_fav: boolean) => void;
  onDelete?: (item: CaseItem) => void;
  onOpen?: (item: CaseItem) => void;
  selectionMode?: boolean;
  selected?: boolean;
  staticMedia?: boolean;
  showSelectionIndicator?: boolean;
}) {
  const { t } = useI18n();
  const analysisStatus = item.ai_status === "analyzing"
    ? { className: "analyzing", label: t("分析中", "Analyzing") }
    : item.ai_status === "failed"
      ? { className: "failed", label: t("分析失败", "Failed") }
      : item.ai_status === "completed" || item.ai_analysis
        ? { className: "completed", label: t("已分析", "Analyzed") }
        : { className: "drafting", label: t("未分析", "Not analyzed") };
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const coverUrl = mediaUrl(item.cover_url || item.image_urls?.[0]);
  const videoUrl = mediaUrl(item.video_url);
  const visuallySelected = selected && showSelectionIndicator;

  useEffect(() => {
    if (!menuOpen) return;
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutsideClick);
    return () => document.removeEventListener("pointerdown", closeOnOutsideClick);
  }, [menuOpen]);

  return (
    <article className={`relative rounded-lg border bg-white transition-[border-color,box-shadow] hover:shadow-[0_4px_12px_rgba(16,24,40,0.06)] dark:bg-slate-950 ${staticMedia ? "amp-case-card-static" : ""} ${
      visuallySelected ? "border-blue-500 dark:border-blue-500" : "border-slate-200 hover:border-blue-200 dark:border-slate-800"
    }`}>
      <button type="button" onClick={() => onOpen?.(item)} className="amp-case-cover-button block w-full text-left"
        aria-pressed={selectionMode ? selected : undefined}
        aria-label={selectionMode
          ? t("选择案例：{title}", "Select case: {title}", { title: item.title })
          : t("查看案例：{title}", "View case: {title}", { title: item.title })}>
        <div className="relative aspect-video overflow-hidden rounded-t-lg bg-slate-100 dark:bg-slate-900">
          {!selectionMode && (
            <span className="amp-case-type-overlay">{contentTypeLabel(item.content_type, t)}</span>
          )}
          {coverUrl ? (
            <Image
              src={coverUrl}
              alt={item.title}
              fill
              unoptimized
              sizes="(min-width: 1280px) 33vw, (min-width: 768px) 50vw, 100vw"
              className="h-full w-full object-cover"
            />
          ) : videoUrl ? (
            <video src={videoUrl}
              className="h-full w-full object-cover"
              muted playsInline preload="metadata" />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-slate-100 text-sm text-slate-500 dark:bg-slate-900">
              {t("待补充封面", "No cover image yet")}
            </div>
          )}
          {is_favorited && (
            <span className="absolute right-2.5 top-2.5 z-10 text-amber-500"
              aria-label={t("已收藏", "Favorited")} title={t("已收藏", "Favorited")}>
              <InlineIcon name="star" className="h-5 w-5" fill="currentColor" strokeWidth={1.5} />
            </span>
          )}
          {selectionMode && showSelectionIndicator && (
            <span className={`absolute left-2.5 top-2.5 z-10 flex h-6 w-6 items-center justify-center rounded-full border ${
              selected ? "border-blue-600 bg-blue-600 text-white" : "border-white bg-white/90 text-transparent shadow-sm"
            }`} aria-hidden="true">
              <InlineIcon name="check" className="h-3.5 w-3.5" strokeWidth={2.5} />
            </span>
          )}
        </div>
      </button>

      <div className="flex flex-col gap-0 px-3 pb-3 pt-1.5">
        <div className="flex items-start gap-2">
          <button type="button" onClick={() => onOpen?.(item)} className="min-w-0 flex-1 text-left">
            <h3 className="truncate text-sm font-semibold leading-5 text-slate-950 dark:text-white" title={item.title}>{item.title}</h3>
          </button>
          {!selectionMode && <div ref={menuRef} className="relative shrink-0">
            <button type="button" onClick={() => setMenuOpen((current) => !current)}
              className="amp-case-card-more"
              aria-label={t("{title} 案例操作", "{title} case actions", { title: item.title })}
              aria-expanded={menuOpen}>
              <InlineIcon name="more" className="h-4 w-4" strokeWidth={2.5} />
            </button>
            {menuOpen && (
              <div role="menu" className="amp-case-card-popover">
                <button type="button" role="menuitem" onClick={() => {
                  setMenuOpen(false);
                  onFavorite?.(item.id, is_favorited);
                }}>
                  <InlineIcon name="star" />
                  {is_favorited ? t("取消收藏", `${ENGLISH_ACTIONS.remove} favorite`) : t("收藏", "Favorite")}
                </button>
                <GuardedButton type="button" role="menuitem" className="amp-case-card-delete"
                  disabled={!canDelete} aria-disabled={!canDelete}
                  blockedReason={t("仅创建者、项目所有者或项目管理员可删除此案例", "Only the creator, project owner or project administrator can delete this case.")}
                  onClick={() => {
                    setMenuOpen(false);
                    onDelete?.(item);
                  }}>
                  <InlineIcon name="trash" />
                  {t(CHINESE_ACTIONS.delete, ENGLISH_ACTIONS.delete)}
                </GuardedButton>
              </div>
            )}
          </div>}
        </div>

        {!selectionMode && <div className="amp-insight-card-meta">
          {item.project_title && <span title={item.project_title}>{item.project_title}</span>}
          <span className={`amp-insight-status amp-insight-status-${analysisStatus.className}`}>
            {analysisStatus.label}
          </span>
          <span className="amp-asset-creator">{item.creator_name || t("未知创建者", "Unknown creator")}</span>
        </div>}

      </div>
    </article>
  );
}
