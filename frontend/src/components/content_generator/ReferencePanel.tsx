"use client";

import { useEffect, useEffectEvent, useId, useRef, useState } from "react";
import CaseCard from "@/components/case_library/case_card";
import EnterpriseSelect from "@/components/redesign/EnterpriseSelect";
import InlineIcon from "@/components/redesign/InlineIcon";
import EmptyStateIcon from "@/components/redesign/EmptyStateIcon";
import { useI18n } from "@/contexts/i18n_context";
import { localizeErrorMessage } from "@/i18n/errors";
import { fetch_history, fetch_my_cases, fetch_my_favorites } from "@/services/api_client";
import type { CaseItem } from "@/types/case_library";
import type { HistoryRecord } from "@/types/market_insight";
import { isCaseAnalyzed } from "@/utils/case_permissions";
import { isInsightAnalyzed } from "@/utils/insight_permissions";

export interface RefLabel { id: string; label: string }

type ReferenceType = "insight" | "case";
type CaseSource = "my" | "favorites";
type CaseFilter = "all" | "video" | "image_text";
type InsightStatusFilter = "all" | "analyzing" | "completed" | "failed";

interface Props {
  open: boolean;
  initial_tab: ReferenceType;
  project_id: string;
  selected_insight_ids: string[];
  selected_case_ids: string[];
  onConfirm: (insight_ids: string[], case_ids: string[], insight_labels: RefLabel[], case_labels: RefLabel[]) => void;
  onClose: () => void;
}

export default function ReferencePanel({
  open, initial_tab, project_id, selected_insight_ids, selected_case_ids,
  onConfirm, onClose,
}: Props) {
  const { t, locale } = useI18n();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [insights, setInsights] = useState<HistoryRecord[]>([]);
  const [projectCases, setProjectCases] = useState<CaseItem[]>([]);
  const [favoriteCases, setFavoriteCases] = useState<CaseItem[]>([]);
  const [pickedInsights, setPickedInsights] = useState<string[]>([]);
  const [pickedCases, setPickedCases] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [caseSource, setCaseSource] = useState<CaseSource>("my");
  const [caseFilter, setCaseFilter] = useState<CaseFilter>("all");
  const [insightStatus, setInsightStatus] = useState<InsightStatusFilter>("all");
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);

  const loadReferences = useEffectEvent(async () => {
    if (!open) return;
    setPickedInsights([...selected_insight_ids]);
    setPickedCases([...selected_case_ids]);
    setSearch("");
    setCaseSource("my");
    setCaseFilter("all");
    setInsightStatus("all");
    setLoadError(null);
    setLoading(true);
    try {
      if (initial_tab === "insight") {
        const response = await fetch_history("", project_id);
        if (!response.success) throw new Error(response.message);
        const items = response.data as HistoryRecord[];
        setInsights(items);
        const analyzedIds = new Set(items.filter(isInsightAnalyzed).map((item) => item.id));
        setPickedInsights((current) => current.filter((id) => analyzedIds.has(id)));
      } else {
        const [projectResponse, favoriteResponse] = await Promise.all([
          fetch_my_cases(100, 0, "", project_id),
          fetch_my_favorites(100, 0),
        ]);
        const projectData = projectResponse.data as { cases: CaseItem[] };
        const favoriteData = favoriteResponse.data as { cases: CaseItem[] };
        setProjectCases(projectData.cases || []);
        setFavoriteCases((favoriteData.cases || []).filter((item) => item.project_id === project_id));
        const analyzedIds = new Set([
          ...(projectData.cases || []),
          ...(favoriteData.cases || []),
        ].filter(isCaseAnalyzed).map((item) => item.id));
        setPickedCases((current) => current.filter((id) => analyzedIds.has(id)));
      }
    } catch (error) {
      setLoadError(error instanceof Error && error.message ? error.message : "Could not load creation references");
      if (initial_tab === "insight") setInsights([]);
      else {
        setProjectCases([]);
        setFavoriteCases([]);
      }
    } finally {
      setLoading(false);
    }
  });

  useEffect(() => {
    void loadReferences();
  }, [open, loadAttempt]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  const toggleInsight = (id: string) => {
    setPickedInsights((current) => {
      if (current.includes(id)) return current.filter((item) => item !== id);
      return [...current, id];
    });
  };

  const allCases = [...projectCases, ...favoriteCases];
  const toggleCase = (item: CaseItem) => {
    setPickedCases((current) => {
      if (current.includes(item.id)) return current.filter((id) => id !== item.id);
      return [...current, item.id];
    });
  };

  const query = search.trim().toLocaleLowerCase(locale);
  const visibleInsights = insights.filter((item) => (
    (insightStatus === "all" || item.status === insightStatus)
    && (!query || [
      item.title, item.filename, item.ai_analysis?.product_category,
      item.ai_analysis?.product_summary, item.ai_analysis?.product_description,
    ].some((value) => value?.toLocaleLowerCase(locale).includes(query)))
  ));
  const sourceCases = caseSource === "favorites" ? favoriteCases : projectCases;
  const visibleCases = sourceCases.filter((item) => (
    isCaseAnalyzed(item)
    && (caseFilter === "all" || item.content_type === caseFilter)
    && (!query || [item.title, item.description, item.ai_analysis?.content_analysis]
      .some((value) => value?.toLocaleLowerCase(locale).includes(query)))
  ));

  const confirm = () => {
    const analyzedInsightIds = new Set(insights.filter(isInsightAnalyzed).map((item) => item.id));
    const confirmedInsightIds = pickedInsights.filter((id) => analyzedInsightIds.has(id));
    const analyzedCaseIds = new Set(allCases.filter(isCaseAnalyzed).map((item) => item.id));
    const confirmedCaseIds = pickedCases.filter((id) => analyzedCaseIds.has(id));
    const insightLabels = initial_tab === "insight"
      ? insights.filter((item) => confirmedInsightIds.includes(item.id))
        .map((item) => ({ id: item.id, label: item.title || item.filename }))
      : [];
    const caseLabels = initial_tab === "case"
      ? allCases.filter((item, index, items) => (
        confirmedCaseIds.includes(item.id) && items.findIndex((candidate) => candidate.id === item.id) === index
      )).map((item) => ({ id: item.id, label: item.title }))
      : [];
    onConfirm(confirmedInsightIds, confirmedCaseIds, insightLabels, caseLabels);
    onClose();
  };

  const title = initial_tab === "insight"
    ? t("引用洞察", "Reference insights")
    : t("引用已分析案例", "Reference analyzed cases");
  return (
    <dialog ref={dialogRef} aria-labelledby={titleId}
      className="amp-workspace-dialog m-auto w-[calc(100%_-_32px)] max-w-2xl overflow-hidden bg-white p-0 text-zinc-900 dark:bg-zinc-950 dark:text-white backdrop:bg-slate-950/40"
      onCancel={(event) => { event.preventDefault(); onClose(); }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          onClose();
        }
      }}
      onClick={(event) => {
        if (event.target !== event.currentTarget) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        if (event.clientX < bounds.left || event.clientX > bounds.right
          || event.clientY < bounds.top || event.clientY > bounds.bottom) onClose();
      }}>
      <div className="relative flex h-[min(720px,85dvh)] min-h-0 flex-col">
        <header className="flex shrink-0 items-center px-5 py-3">
          <h2 id={titleId} className="text-base font-semibold">{title}</h2>
        </header>

        <div className="flex shrink-0 flex-wrap items-center gap-2 px-3 pt-3 sm:flex-nowrap">
          <label className="relative w-full sm:min-w-0 sm:flex-1">
            <InlineIcon name="search" className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
            <input value={search} onChange={(event) => setSearch(event.target.value)}
              aria-label={initial_tab === "insight" ? t("搜索洞察", "Search insights") : t("搜索案例", "Search cases")}
              placeholder={initial_tab === "insight" ? t("搜索洞察", "Search insights") : t("搜索案例", "Search cases")}
              className="h-10 w-full rounded-lg border border-zinc-200 bg-white pl-8 pr-8 text-xs text-zinc-900 placeholder:text-zinc-400 focus:border-violet-500 focus:outline-none dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100" />
            {search && (
              <button type="button" onClick={() => setSearch("")} aria-label={t("清除搜索", "Clear search")}
                className="absolute right-2 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-full text-zinc-500 hover:bg-zinc-100">
                <InlineIcon name="close" className="h-3 w-3" />
              </button>
            )}
          </label>
          {initial_tab === "insight" && (
            <EnterpriseSelect value={insightStatus}
              options={[
                { value: "all", label: t("全部状态", "All statuses") },
                { value: "analyzing", label: t("分析中", "Analyzing") },
                { value: "completed", label: t("已完成", "Completed") },
                { value: "failed", label: t("失败", "Failed") },
              ]}
              onChange={setInsightStatus} ariaLabel={t("洞察分析状态", "Insight analysis status")}
              className="w-full shrink-0 whitespace-nowrap sm:w-40" />
          )}
          {initial_tab === "case" && (
            <>
              <EnterpriseSelect value={caseSource}
                options={[
                  { value: "my", label: t("项目案例", "Project cases") },
                  { value: "favorites", label: t("收藏案例", "Favorite cases") },
                ]}
                onChange={setCaseSource} ariaLabel={t("筛选案例来源", "Filter case source")}
                className="w-[calc(50%_-_4px)] min-w-40 shrink-0 whitespace-nowrap sm:w-40" />
              <EnterpriseSelect value={caseFilter}
                options={[
                  { value: "all", label: t("全部形式", "All formats") },
                  { value: "video", label: t("视频", "Video") },
                  { value: "image_text", label: t("图文", "Image post") },
                ]}
                onChange={setCaseFilter} ariaLabel={t("筛选内容形式", "Filter content format")}
                className="w-[calc(50%_-_4px)] shrink-0 sm:w-32" />
            </>
          )}
        </div>

        <main className="flex min-h-0 flex-1 flex-col overflow-y-auto px-3 py-3">
          {loading ? (
            <div className="amp-dialog-state" role="status">
              <span className="text-sm text-zinc-500">{t("正在加载…", "Loading…")}</span>
            </div>
          ) : loadError ? (
            <div className="amp-dialog-state" role="alert">
              <p className="text-sm text-zinc-500">{localizeErrorMessage(loadError, locale)}</p>
              <button type="button" className="amp-button amp-button-secondary mt-3"
                onClick={() => setLoadAttempt((current) => current + 1)}>{t("重试", "Retry")}</button>
            </div>
          ) : initial_tab === "insight" ? (
            visibleInsights.length ? (
              <div className="amp-reference-card-grid">
                {visibleInsights.map((item) => {
                  const selectable = isInsightAnalyzed(item);
                  const selected = selectable && pickedInsights.includes(item.id);
                  const summary = item.ai_analysis?.product_summary
                    || item.ai_analysis?.product_description || t("暂无洞察摘要", "No insight summary");
                  return (
                    <button key={item.id} type="button"
                      className={`amp-reference-insight-card ${selected ? "amp-reference-insight-card-selected" : ""}`}
                      onClick={() => { if (selectable) toggleInsight(item.id); }}
                      disabled={!selectable}
                      aria-pressed={selected}
                      aria-label={t("选择洞察：{title}", "Select insight: {title}", { title: item.title || item.filename })}>
                      <strong title={item.title || item.filename}>{item.title || item.filename}</strong>
                      <p title={summary}><span>{summary}</span></p>
                      <span className={`amp-insight-status amp-insight-status-${item.status}`}>
                        {item.status === "analyzing"
                          ? t("分析中", "Analyzing")
                          : item.status === "failed"
                            ? t("失败", "Failed")
                            : t("已完成", "Completed")}
                      </span>
                      <span className={`amp-reference-card-check ${selected ? "amp-reference-card-check-selected" : ""}`} aria-hidden="true">
                        <InlineIcon name="check" />
                      </span>
                    </button>
                  );
                })}
              </div>
            ) : <div className="amp-dialog-state amp-empty-state text-sm text-zinc-400">
              <EmptyStateIcon name={search ? "search" : "insight"} />
              <p>{search ? t("没有匹配的洞察", "No matching insights") : t("暂无项目洞察", "No project insights yet")}</p>
            </div>
          ) : visibleCases.length ? (
            <div className="amp-reference-card-grid">
              {visibleCases.map((item) => (
                <CaseCard key={item.id} item={item}
                  is_favorited={item.is_favorited || caseSource === "favorites"}
                  selectionMode selected={pickedCases.includes(item.id)}
                  onOpen={() => toggleCase(item)} />
              ))}
            </div>
          ) : <div className="amp-dialog-state amp-empty-state text-sm text-zinc-400">
            <EmptyStateIcon name={search ? "search" : "case"} />
            <p>{search
              ? t("没有匹配的已分析案例", "No matching analyzed cases")
              : caseSource === "favorites" ? t("暂无已分析收藏案例", "No analyzed favorite cases yet") : t("暂无已分析案例", "No analyzed cases yet")}</p>
          </div>}
        </main>

        <footer className="flex shrink-0 gap-2 px-4 py-3">
          <button type="button" onClick={onClose}
            className="min-h-[44px] flex-1 rounded-xl border border-zinc-200 text-sm text-zinc-500 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900">
            {t("取消", "Cancel")}
          </button>
          <button type="button" onClick={confirm} className="amp-button amp-button-primary flex-1">
            {t("确认选择", "Confirm selection")}
          </button>
        </footer>
      </div>
    </dialog>
  );
}
