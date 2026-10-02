"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "@/contexts/auth_context";
import { useI18n } from "@/contexts/i18n_context";
import { useToast } from "@/contexts/toast_context";
import { localizeErrorMessage } from "@/i18n/errors";
import {
  download_source_file,
  fetch_content_projects,
  fetch_history_item,
  fetch_insight_sources,
  fetch_source_preview,
  retry_history_item,
  update_history_item,
} from "@/services/api_client";
import type { AIAnalysis, HistoryRecord, InsightSource, SourcePreview } from "@/types/market_insight";
import type { ContentProject } from "@/types/publishing";
import InlineIcon from "@/components/redesign/InlineIcon";
import EmptyStateIcon from "@/components/redesign/EmptyStateIcon";
import InsightProjectSidebar from "@/components/market_insight/InsightProjectSidebar";
import { canManageInsight } from "@/utils/insight_permissions";
import { startPolling } from "@/utils/polling";

type InsightTab = "result" | "sources";

function InsightList({ values, empty }: { values: string[]; empty: string }) {
  if (values.length === 0) return <p className="amp-insight-empty-copy">{empty}</p>;
  return (
    <ul className="amp-insight-detail-list">
      {values.map((value, index) => <li key={`${value}-${index}`}>{value}</li>)}
    </ul>
  );
}

export default function MarketInsightDetailPage() {
  const params = useParams<{ insightId: string }>();
  const insightId = params.insightId;
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const { t, locale } = useI18n();
  const { showError, showSuccess } = useToast();
  const sourcePreviewDialogRef = useRef<HTMLDialogElement>(null);
  const [insight, setInsight] = useState<HistoryRecord | null>(null);
  const [sources, setSources] = useState<InsightSource[]>([]);
  const [selectedSource, setSelectedSource] = useState<InsightSource | null>(null);
  const [projects, setProjects] = useState<ContentProject[]>([]);
  const [tab, setTab] = useState<InsightTab>("result");
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [sourcePreview, setSourcePreview] = useState<SourcePreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewLoadingMore, setPreviewLoadingMore] = useState(false);
  const [sourceDownloading, setSourceDownloading] = useState(false);
  const [draft, setDraft] = useState<AIAnalysis | null>(null);

  useEffect(() => {
    if (!authLoading && !user) router.replace("/");
  }, [authLoading, router, user]);

  useEffect(() => {
    if (!user || !insightId) return;
    let cancelled = false;
    setLoading(true);
    Promise.all([
      fetch_history_item(insightId),
      fetch_content_projects(),
      fetch_insight_sources(insightId),
    ])
      .then(([insightResponse, projectsResponse, sourcesResponse]) => {
        if (cancelled) return;
        setInsight(insightResponse.data);
        setProjects(projectsResponse.data || []);
        setSources(sourcesResponse.data || []);
      })
      .catch((error) => {
        if (!cancelled) {
          showError(localizeErrorMessage(error instanceof Error ? error.message : "Could not load insight", locale));
          router.replace("/market_insight");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [insightId, locale, router, showError, user]);

  useEffect(() => {
    if (!user || insight?.id !== insightId || insight.status !== "analyzing") return;
    return startPolling({
      load: () => fetch_history_item(insightId),
      onResult: (response) => {
        setInsight(response.data);
        return response.data.status === "analyzing";
      },
      onError: (error) => {
        showError(localizeErrorMessage(error instanceof Error ? error.message : "Could not refresh insight", locale));
      },
    });
  }, [insight?.id, insight?.status, insightId, locale, showError, user]);

  const retryAnalysis = async () => {
    if (!insight || retrying || !canManageInsight(user, insight)) return;
    setRetrying(true);
    try {
      const response = await retry_history_item(insight.id, locale);
      setInsight(response.data);
      setTab("result");
      showSuccess(t("已重新开始分析", "Analysis restarted"));
    } catch (error) {
      showError(localizeErrorMessage(error instanceof Error ? error.message : "Could not restart analysis", locale));
    } finally {
      setRetrying(false);
    }
  };

  const openSourcePreview = async (source: InsightSource) => {
    if (previewLoading || !insight) return;
    if (selectedSource?.id === source.id && sourcePreview) {
      sourcePreviewDialogRef.current?.showModal();
      return;
    }
    setSelectedSource(source);
    setSourcePreview(null);
    setPreviewLoading(true);
    try {
      const response = await fetch_source_preview(insight.id, source.id);
      setSourcePreview(response.data);
      window.requestAnimationFrame(() => sourcePreviewDialogRef.current?.showModal());
    } catch (error) {
      showError(localizeErrorMessage(error instanceof Error ? error.message : "Could not load source preview", locale));
    } finally {
      setPreviewLoading(false);
    }
  };

  const downloadSourceFile = async () => {
    if (!insight || !selectedSource || sourceDownloading) return;
    setSourceDownloading(true);
    try {
      const blob = await download_source_file(insight.id, selectedSource.id);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = selectedSource.filename;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      showError(localizeErrorMessage(error instanceof Error ? error.message : "Could not download source file", locale));
    } finally {
      setSourceDownloading(false);
    }
  };

  const loadMoreSourcePreview = async () => {
    if (!insight || !selectedSource || !sourcePreview?.has_more || previewLoadingMore) return;
    setPreviewLoadingMore(true);
    try {
      const response = await fetch_source_preview(
        insight.id, selectedSource.id, sourcePreview.next_offset,
      );
      setSourcePreview((current) => current ? {
        ...response.data,
        content: current.content + response.data.content,
        offset: current.offset,
      } : response.data);
    } catch (error) {
      showError(localizeErrorMessage(error instanceof Error ? error.message : "Could not load more source content", locale));
    } finally {
      setPreviewLoadingMore(false);
    }
  };

  const startEditing = () => {
    if (!insight || !canManageInsight(user, insight) || !insight.ai_analysis
      || (insight.source_type !== "manual" && ["analyzing", "failed"].includes(insight.status))) return;
    setDraft(structuredClone(insight.ai_analysis));
    setTab("result");
    setEditing(true);
  };

  const updateDraft = <K extends keyof AIAnalysis>(key: K, value: AIAnalysis[K]) => {
    setDraft((current) => current ? { ...current, [key]: value } : current);
  };

  const saveInsight = async () => {
    if (!insight || !canManageInsight(user, insight) || !draft || !draft.product_name.trim()) {
      showError(t("洞察名称不能为空", "Insight name is required"));
      return;
    }
    const normalizeItems = (values: string[]) => values.map((value) => value.trim()).filter(Boolean);
    setSaving(true);
    try {
      const response = await update_history_item(insight.id, {
        ...draft,
        product_name: draft.product_name.trim(),
        strengths: normalizeItems(draft.strengths),
        weaknesses: normalizeItems(draft.weaknesses),
        use_cases: normalizeItems(draft.use_cases),
        tech_highlights: normalizeItems(draft.tech_highlights),
        similar_products: normalizeItems(draft.similar_products),
        suggested_marketing_angles: normalizeItems(draft.suggested_marketing_angles),
      });
      setInsight(response.data);
      setDraft(null);
      setEditing(false);
      showSuccess(t("洞察已保存", "Insight saved"));
    } catch (error) {
      showError(localizeErrorMessage(error instanceof Error ? error.message : "Could not update insight", locale));
    } finally {
      setSaving(false);
    }
  };

  if (authLoading || loading || !insight || !user) {
    return <div className="amp-page-state" role="status">{t("正在加载洞察...", "Loading insight...")}</div>;
  }

  const analysis = insight.ai_analysis;
  const name = insight.title || insight.filename;
  const externalAnalysis = insight.source_type !== "manual";
  const editingLocked = externalAnalysis && ["analyzing", "failed"].includes(insight.status);
  const canManage = canManageInsight(user, insight);
  const canEdit = canManage && !editingLocked;
  const canRetry = canManage && externalAnalysis && ["failed", "completed"].includes(insight.status);
  const statusLabel = insight.status === "analyzing"
    ? t("分析中", "Analyzing")
    : insight.status === "failed" ? t("失败", "Failed") : t("已完成", "Completed");

  return (
    <div className="amp-project-detail-layout">
      <InsightProjectSidebar projects={projects} selectedProjectId={insight.project_id} />
      <main className="amp-project-detail-main">
        <header className="amp-project-detail-header">
          <div className="amp-project-detail-title">
            <Link href={`/market_insight?project=${encodeURIComponent(insight.project_id)}`}
              className="amp-project-detail-back" aria-label={t("返回洞察列表", "Back to insights")}>
              <InlineIcon name="arrowLeft" />
            </Link>
            <div>
              <div className="amp-insight-title-row">
                <h1>{name}</h1>
                <span className={`amp-insight-status amp-insight-status-${insight.status}`}>{statusLabel}</span>
              </div>
              <p><Link href={`/projects/${encodeURIComponent(insight.project_id)}`}>{insight.project_title}</Link></p>
            </div>
          </div>
          {!editing && (canRetry || canEdit) && (
            <div className="flex gap-2">
              {canRetry && (
                <button type="button" className="amp-button amp-button-secondary"
                  disabled={retrying} onClick={() => void retryAnalysis()}>
                  <InlineIcon name="refresh" className="h-4 w-4" />
                  {retrying ? t("正在重新分析...", "Restarting...") : t("重新分析", "Retry analysis")}
                </button>
              )}
              {canEdit && (
                <button type="button" className="amp-button amp-button-secondary" disabled={retrying} onClick={startEditing}>
                  <InlineIcon name="edit" className="h-4 w-4" />
                  {t("编辑", "Edit")}
                </button>
              )}
            </div>
          )}
        </header>

        <div className="amp-project-detail-tabs" role="tablist">
          <button type="button" role="tab" aria-selected={tab === "result"} onClick={() => setTab("result")}>{t("洞察结果", "Insight result")}</button>
          <button type="button" role="tab" aria-selected={tab === "sources"} disabled={editing}
            onClick={() => setTab("sources")}>{t("资料来源", "Sources")}</button>
        </div>

        {tab === "result" && (
          insight.status === "analyzing" ? (
            <div className="amp-insight-processing" role="status">
              <span className="amp-insight-processing-icon"><InlineIcon name="sparkle" /></span>
              <strong>{t("AI 正在分析资料", "AI is analyzing the source material")}</strong>
              <p>{t("分析完成后，本页面会自动更新。", "This page updates automatically when analysis is complete.")}</p>
            </div>
          ) : !analysis ? (
            <div className="amp-projects-state amp-insight-empty-result amp-empty-state">
              <EmptyStateIcon name={insight.status === "failed" ? "alert" : "insight"} />
              <strong>{insight.status === "failed"
                ? t("分析失败或已中断", "Analysis failed or was interrupted")
                : t("暂时没有可展示的洞察结果", "No insight result is available")}</strong>
              {insight.status === "failed" && <p>{canRetry
                ? t("原始资料已保留，请点击“重新分析”重试。", "Your source material is preserved. Select Retry analysis to try again.")
                : t("请联系创建者或项目管理员重新分析。", "Ask the creator or a project administrator to retry the analysis.")}</p>}
            </div>
          ) : editing && draft ? (
            <form className="amp-insight-edit-form" onSubmit={(event) => { event.preventDefault(); void saveInsight(); }}>
              <div className="amp-insight-edit-grid">
                <label className="amp-insight-edit-wide"><span>{t("洞察摘要", "Insight summary")}</span>
                  <textarea className="amp-workspace-control resize-none" rows={3} value={draft.product_summary}
                    onChange={(event) => updateDraft("product_summary", event.target.value)} /></label>
                <label><span>{t("目标受众", "Target audience")}</span>
                  <textarea className="amp-workspace-control resize-none" rows={4} value={draft.target_audience}
                    onChange={(event) => updateDraft("target_audience", event.target.value)} /></label>
                <label><span>{t("市场定位", "Market positioning")}</span>
                  <textarea className="amp-workspace-control resize-none" rows={4} value={draft.market_positioning}
                    onChange={(event) => updateDraft("market_positioning", event.target.value)} /></label>
                {([
                  ["strengths", t("产品优势", "Strengths")],
                  ["weaknesses", t("潜在劣势", "Weaknesses")],
                  ["use_cases", t("使用场景", "Use cases")],
                  ["tech_highlights", t("技术亮点", "Technical highlights")],
                  ["similar_products", t("竞品", "Similar products")],
                  ["suggested_marketing_angles", t("建议营销角度", "Suggested marketing angles")],
                ] as Array<[keyof AIAnalysis, string]>).map(([key, label]) => (
                  <label key={key}><span>{label}</span>
                    <textarea className="amp-workspace-control resize-none" rows={4}
                      value={(draft[key] as string[]).join("\n")}
                      placeholder={t("每行一项", "One item per line")}
                      onChange={(event) => updateDraft(
                        key,
                        event.target.value.split("\n") as never,
                      )} /></label>
                ))}
              </div>
              <div className="amp-insight-edit-actions">
                <button type="button" className="amp-button amp-button-secondary" disabled={saving}
                  onClick={() => { setEditing(false); setDraft(null); }}>{t("取消", "Cancel")}</button>
                <button type="submit" className="amp-button amp-button-primary" disabled={saving}>
                  {saving ? t("保存中...", "Saving...") : t("保存洞察", "Save insight")}
                </button>
              </div>
            </form>
          ) : (
            <div className="amp-insight-detail-grid">
              <section className="amp-insight-detail-card amp-insight-detail-wide">
                <h2>{t("洞察摘要", "Insight summary")}</h2>
                <p>{analysis.product_summary || t("暂无洞察摘要", "No insight summary")}</p>
              </section>
              <section className="amp-insight-detail-card">
                <h2>{t("目标受众", "Target audience")}</h2>
                <p>{analysis.target_audience || t("暂无内容", "No content")}</p>
              </section>
              <section className="amp-insight-detail-card">
                <h2>{t("市场定位", "Market positioning")}</h2>
                <p>{analysis.market_positioning || t("暂无内容", "No content")}</p>
              </section>
              <section className="amp-insight-detail-card">
                <h2>{t("产品优势", "Strengths")}</h2>
                <InsightList values={analysis.strengths} empty={t("暂无内容", "No content")} />
              </section>
              <section className="amp-insight-detail-card">
                <h2>{t("潜在劣势", "Weaknesses")}</h2>
                <InsightList values={analysis.weaknesses} empty={t("暂无内容", "No content")} />
              </section>
              <section className="amp-insight-detail-card">
                <h2>{t("使用场景", "Use cases")}</h2>
                <InsightList values={analysis.use_cases} empty={t("暂无内容", "No content")} />
              </section>
              <section className="amp-insight-detail-card">
                <h2>{t("技术亮点", "Technical highlights")}</h2>
                <InsightList values={analysis.tech_highlights} empty={t("暂无内容", "No content")} />
              </section>
              <section className="amp-insight-detail-card">
                <h2>{t("竞品", "Similar products")}</h2>
                <InsightList values={analysis.similar_products} empty={t("暂无内容", "No content")} />
              </section>
              <section className="amp-insight-detail-card">
                <h2>{t("建议营销角度", "Suggested marketing angles")}</h2>
                <InsightList values={analysis.suggested_marketing_angles} empty={t("暂无内容", "No content")} />
              </section>
            </div>
          )
        )}

        {tab === "sources" && (
          <section className="amp-insight-source-section">
            <div className="amp-insight-source-list">
              {sources.map((source) => {
                const previewable = source.source_type !== "manual";
                return (
                  <article key={source.id}
                    className={`amp-insight-source-card${previewable ? " amp-insight-source-card-previewable" : ""}`}
                    role={previewable ? "button" : undefined}
                    tabIndex={previewable ? 0 : undefined}
                    aria-label={previewable ? t("预览资料：{name}", "Preview source: {name}", { name: source.filename }) : undefined}
                    onClick={previewable ? () => void openSourcePreview(source) : undefined}
                    onKeyDown={previewable ? (event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        void openSourcePreview(source);
                      }
                    } : undefined}>
                    <span className="amp-insight-source-icon">
                      <InlineIcon name={source.source_type === "manual" ? "edit" : source.source_type === "repo" ? "folder" : "file"} />
                    </span>
                    <span className="amp-insight-source-copy">
                      <strong>{source.filename}</strong>
                      <span>{source.source_type === "manual"
                        ? t("直接创建的空白洞察", "A blank insight created manually")
                        : source.source_type === "repo"
                          ? t("从代码仓库解析", "Parsed from a code repository")
                          : t("从上传资料解析", "Parsed from an uploaded document")}</span>
                      <small>
                        {new Date(`${source.upload_time.replace(" ", "T")}Z`).toLocaleString(locale)}
                        {source.file_size > 0 && ` · ${(source.file_size / 1024).toFixed(1)} KB`}
                      </small>
                    </span>
                    <span className="amp-insight-source-type">
                      {source.source_type === "manual"
                        ? t("手动创建", "Manual")
                        : source.source_type === "repo" ? t("仓库", "Repository") : t("文档", "Document")}
                    </span>
                  </article>
                );
              })}
            </div>
          </section>
        )}

        <dialog ref={sourcePreviewDialogRef} aria-labelledby="source-preview-title"
          className="amp-workspace-dialog amp-insight-source-preview-dialog m-auto w-[calc(100%_-_32px)] max-w-5xl bg-white text-slate-950 backdrop:bg-slate-950/40">
          <header className="amp-insight-source-preview-header">
            <div>
              <h2 id="source-preview-title">{t("资料预览", "Source preview")}</h2>
              <p>{sourcePreview?.filename || selectedSource?.filename || insight.filename}</p>
            </div>
            <div className="amp-insight-source-preview-header-actions">
              {selectedSource?.source_type === "repo" && (
                <a href={selectedSource.filename} target="_blank" rel="noreferrer">
                  {t("打开仓库", "Open repository")}
                </a>
              )}
              {selectedSource?.has_source_file && (
                <button type="button" className="amp-insight-source-download"
                  disabled={sourceDownloading} onClick={() => void downloadSourceFile()}>
                  {sourceDownloading ? t("下载中...", "Downloading...") : t("下载原文件", "Download original")}
                </button>
              )}
              <button type="button" className="amp-insight-source-preview-close"
                aria-label={t("关闭预览", "Close preview")}
                onClick={() => sourcePreviewDialogRef.current?.close()}>
                <InlineIcon name="close" />
              </button>
            </div>
          </header>
          <div className="amp-insight-source-preview-body">
            {sourcePreview?.content ? <pre>{sourcePreview.content}</pre> : (
              <div className="amp-insight-source-preview-empty amp-empty-state">
                <EmptyStateIcon name="file" />
                <p>{t("暂无可预览内容", "No preview content available")}</p>
              </div>
            )}
            {sourcePreview?.has_more && (
              <button type="button" className="amp-insight-source-preview-more"
                disabled={previewLoadingMore} onClick={() => void loadMoreSourcePreview()}>
                {previewLoadingMore ? t("加载中...", "Loading...") : t("加载更多", "Load more")}
              </button>
            )}
          </div>
        </dialog>

      </main>
    </div>
  );
}
