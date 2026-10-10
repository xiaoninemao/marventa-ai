"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { useI18n } from "@/contexts/i18n_context";
import { useToast } from "@/contexts/toast_context";
import { localizeErrorMessage } from "@/i18n/errors";
import { CHINESE_ACTIONS, ENGLISH_ACTIONS } from "@/i18n/interaction_copy";
import { select_publication_work, fetch_scripts } from "@/services/api_client";
import type { PortfolioScript } from "@/types/portfolio";
import type { PublicationPlan } from "@/types/publishing";
import ReferencePickerDialog from "@/components/content_generator/ReferencePickerDialog";
import ReferencePickerSearch from "@/components/content_generator/ReferencePickerSearch";
import { GuardedButton } from "@/components/redesign/GuardedControls";
import EmptyStateIcon from "@/components/redesign/EmptyStateIcon";
import EnterpriseSelect from "@/components/redesign/EnterpriseSelect";

export default function PublicationWorkDialog({ open, plan, onClose, onSelected }: {
  open: boolean;
  plan: PublicationPlan;
  onClose: () => void;
  onSelected: (plan: PublicationPlan) => void;
}) {
  const { t, locale } = useI18n();
  const { showError } = useToast();
  const projectId = plan.project_id;
  const [works, setWorks] = useState<PortfolioScript[]>([]);
  const [workId, setWorkId] = useState("");
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<"all" | "image" | "video">("all");
  const [videoErrors, setVideoErrors] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (open) { setQuery(""); setTypeFilter("all"); }
  }, [open]);
  useEffect(() => {
    if (!open || !projectId) return;
    let cancelled = false;
    setLoading(true); setError(""); setWorks([]); setWorkId(""); setVideoErrors({});
    fetch_scripts(projectId).then(response => {
      if (!response.success) throw new Error(response.message);
      if (cancelled) return;
      setWorks(response.data.filter(work => work.project_id === projectId && work.status === "completed"
        && Boolean(work.media_kind) && Boolean(work.media?.length)));
      setWorkId(plan.portfolio_id);
    }).catch(failure => {
      if (!cancelled) setError(localizeErrorMessage(failure instanceof Error ? failure.message : "Could not load portfolio work", locale));
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open, projectId, plan.portfolio_id, attempt, locale]);
  const selected = works.find(work => work.id === workId);
  const searchQuery = query.trim().toLocaleLowerCase(locale);
  const hasFilters = Boolean(searchQuery) || typeFilter !== "all";
  const visible = works.filter(work => (typeFilter === "all" || work.media_kind === typeFilter)
    && work.name.toLocaleLowerCase(locale).includes(searchQuery));
  const busyReason = t("正在选择作品，请稍候", "Work selection is being saved. Please wait.");
  const reason = saving ? busyReason : loading ? t("正在加载作品", "Loading works")
    : error || (!selected ? t("请选择作品", "Select a work") : "");
  const close = () => {
    if (saving) { showError(busyReason); return; }
    onClose();
  };
  const select = async () => {
    if (reason || !selected) { showError(reason); return; }
    setSaving(true);
    try {
      const response = await select_publication_work(plan.id, selected.id);
      if (!response.success) throw new Error(response.message);
      onSelected(response.data);
      onClose();
    } catch (failure) {
      showError(localizeErrorMessage(failure instanceof Error ? failure.message : "Could not update publication plan", locale));
    } finally {
      setSaving(false);
    }
  };
  return <ReferencePickerDialog open={open} title={t("选择作品", "Select work")}
    className="amp-publication-work-dialog" onClose={close}>
    <form className="flex min-h-0 flex-1 flex-col" onSubmit={event => { event.preventDefault(); void select(); }}>
      <div className="flex shrink-0 flex-wrap items-center gap-2 px-3 pt-1 sm:flex-nowrap">
        <ReferencePickerSearch value={query} onChange={setQuery}
          placeholder={t("搜索作品名称", "Search work names")} ariaLabel={t("搜索作品", "Search works")} />
        <EnterpriseSelect value={typeFilter} options={[
          { value: "all", label: t("全部类型", "All types") },
          { value: "image", label: t("图文作品", "Image and copy") },
          { value: "video", label: t("视频作品", "Video work") },
        ]} onChange={setTypeFilter} ariaLabel={t("作品类型", "Work type")} disabled={saving}
          disabledReason={busyReason} className="w-full shrink-0 whitespace-nowrap sm:w-40" />
      </div>
      <main className="amp-reference-picker-body">
      {loading ? <div className="amp-dialog-state" role="status">{t("加载中", "Loading")}</div>
        : error ? <div className="amp-dialog-state" role="alert"><p>{error}</p><button type="button" className="amp-button amp-button-secondary"
          onClick={() => setAttempt(value => value + 1)}>{t("重试", "Retry")}</button></div>
          : !visible.length ? <div className="amp-dialog-state amp-empty-state">
            <EmptyStateIcon name={hasFilters ? "search" : "briefcase"} />
            <p>{hasFilters ? t("没有匹配的作品", "No matching works") : t("暂无可选作品", "No works available")}</p>
          </div>
            : <div className="amp-reference-card-grid amp-publication-work-grid">{visible.map(work => <label key={work.id}
              className={`amp-publication-work-option${work.id === workId ? " is-selected" : ""}`}>
              <input type="radio" name="publication-work" value={work.id} checked={work.id === workId}
                onChange={() => { if (!saving) setWorkId(work.id); }}
                aria-disabled={saving} onClick={event => { if (saving) { event.preventDefault(); showError(busyReason); } }} />
              <span className="amp-publication-work-option-cover">
                {work.media?.[0]?.media_type === "image"
                  ? <Image src={work.media[0].file_url} alt="" width={200} height={120} unoptimized />
                  : videoErrors[work.id] ? <span className="amp-publication-work-cover-error" role="alert">
                    <span>{t("视频封面加载失败", "Could not load video cover")}</span>
                    <GuardedButton type="button" className="amp-text-action" disabled={saving} blockedReason={busyReason}
                      onClick={event => {
                        event.preventDefault(); event.stopPropagation();
                        setVideoErrors(current => ({ ...current, [work.id]: false }));
                      }}>{t("重试", "Retry")}</GuardedButton>
                  </span> : <video src={work.media?.[0]?.file_url} muted playsInline preload="metadata"
                    aria-label={t("{name} 视频封面", "Video cover for {name}", { name: work.name })}
                    onLoadedMetadata={event => {
                      const video = event.currentTarget;
                      if (Number.isFinite(video.duration) && video.duration > 0) video.currentTime = Math.min(0.1, video.duration / 2);
                    }}
                    onError={() => setVideoErrors(current => ({ ...current, [work.id]: true }))} />}
                <span className="amp-case-type-overlay">{work.media_kind === "video" ? t("视频", "Video") : t("图文", "Image post")}</span>
              </span>
              <strong title={work.name}>{work.name}</strong>
            </label>)}</div>}
      </main>
      <footer className="amp-reference-picker-footer justify-end">
        <GuardedButton type="button" className="amp-button amp-button-secondary amp-button-cancel" disabled={saving}
          blockedReason={busyReason} onClick={close}>{t(CHINESE_ACTIONS.cancel, ENGLISH_ACTIONS.cancel)}</GuardedButton>
        <GuardedButton type="submit" className="amp-button amp-button-primary" disabled={Boolean(reason)}
          blockedReason={reason}>{saving ? t("保存中", "Saving") : t("确定", "Confirm")}</GuardedButton>
      </footer>
    </form>
  </ReferencePickerDialog>;
}
