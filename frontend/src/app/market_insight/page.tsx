"use client";

import { Suspense, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/contexts/auth_context";
import { useI18n } from "@/contexts/i18n_context";
import { useToast } from "@/contexts/toast_context";
import { localizeErrorMessage } from "@/i18n/errors";
import { ENGLISH_ACTIONS, ENGLISH_PROGRESS, CHINESE_PROGRESS, CHINESE_ACTIONS } from "@/i18n/interaction_copy";
import {
  create_manual_insight,
  delete_history_item,
  fetch_content_projects,
  fetch_history,
  parse_files,
  parse_repo,
  rename_history_item,
} from "@/services/api_client";
import type { AIAnalysis, HistoryRecord } from "@/types/market_insight";
import type { ContentProject } from "@/types/publishing";
import EnterpriseSelect from "@/components/redesign/EnterpriseSelect";
import Pagination from "@/components/redesign/Pagination";
import { DEFAULT_PAGE_SIZE_OPTIONS, usePagination } from "@/utils/pagination";
import { GuardedButton, GuardedInput, useBlockedInteraction } from "@/components/redesign/GuardedControls";
import InlineIcon from "@/components/redesign/InlineIcon";
import RedesignInput from "@/components/redesign/RedesignInput";
import InsightProjectSidebar from "@/components/market_insight/InsightProjectSidebar";
import DeleteConfirmDialog from "@/components/redesign/DeleteConfirmDialog";
import { canManageInsight } from "@/utils/insight_permissions";
import { startPolling } from "@/utils/polling";

type CreateMode = "files" | "repo" | "manual";
type StatusFilter = "all" | "analyzing" | "completed" | "failed";
type InsightSort = "latest" | "oldest" | "name";

const EMPTY_ANALYSIS: AIAnalysis = {
  product_name: "",
  product_category: "",
  product_description: "",
  product_images: [],
  similar_products: [],
  strengths: [],
  weaknesses: [],
  product_summary: "",
  target_audience: "",
  use_cases: [],
  market_positioning: "",
  tech_highlights: [],
  suggested_marketing_angles: [],
  marketing_stage: "",
};

function insightTimestamp(value: string) {
  const normalized = value.includes("T") ? value : `${value.replace(" ", "T")}Z`;
  const timestamp = new Date(normalized).getTime();
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

function MarketInsightOverview() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, loading: authLoading } = useAuth();
  const { t, locale } = useI18n();
  const { showError, showSuccess, showWarning } = useToast();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const renameDialogRef = useRef<HTMLDialogElement>(null);
  const selectedFilesRef = useRef<HTMLDivElement>(null);
  const insightMenuRef = useRef<HTMLDivElement>(null);
  const [projects, setProjects] = useState<ContentProject[]>([]);
  const [insights, setInsights] = useState<HistoryRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [sort, setSort] = useState<InsightSort>("latest");
  const [projectId, setProjectId] = useState("");
  const [mode, setMode] = useState<CreateMode>("files");
  const [files, setFiles] = useState<File[]>([]);
  const [filesExpanded, setFilesExpanded] = useState(false);
  const [menuInsightId, setMenuInsightId] = useState<string | null>(null);
  const [pendingDeleteInsight, setPendingDeleteInsight] = useState<HistoryRecord | null>(null);
  const [deletingInsight, setDeletingInsight] = useState(false);
  const [renamingInsight, setRenamingInsight] = useState<HistoryRecord | null>(null);
  const [renameName, setRenameName] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [repoUrl, setRepoUrl] = useState("");
  const [manualName, setManualName] = useState("");
  const selectedProjectId = searchParams.get("project") || "";
  const creatingReason = t("正在处理中，请稍候。", "Please wait for the current operation to finish.");
  const uploadInteraction = useBlockedInteraction(creating, creatingReason);

  useEffect(() => {
    if (!authLoading && !user) router.replace("/");
  }, [authLoading, router, user]);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    setLoading(true);
    Promise.all([fetch_content_projects(), fetch_history("", selectedProjectId)])
      .then(([projectsResponse, insightsResponse]) => {
        if (cancelled) return;
        const availableProjects = projectsResponse.data || [];
        setProjects(availableProjects);
        setInsights(insightsResponse.data || []);
        setProjectId((current) => {
          if (selectedProjectId && availableProjects.some((project) => project.id === selectedProjectId)) {
            return selectedProjectId;
          }
          return current && availableProjects.some((project) => project.id === current)
            ? current
            : availableProjects[0]?.id || "";
        });
      })
      .catch((error) => {
        if (!cancelled) {
          showError(localizeErrorMessage(error instanceof Error ? error.message : "Could not load insights", locale));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [locale, selectedProjectId, showError, user]);

  useEffect(() => {
    if (!filesExpanded) return;
    const collapseOnOutsideClick = (event: PointerEvent) => {
      if (!selectedFilesRef.current?.contains(event.target as Node)) {
        setFilesExpanded(false);
      }
    };
    document.addEventListener("pointerdown", collapseOnOutsideClick);
    return () => document.removeEventListener("pointerdown", collapseOnOutsideClick);
  }, [filesExpanded]);

  const hasAnalyzingInsights = insights.some((insight) => insight.status === "analyzing");
  useEffect(() => {
    if (!user || loading || !hasAnalyzingInsights) return;
    return startPolling({
      load: () => fetch_history("", selectedProjectId),
      onResult: (response) => {
        const updated = response.data || [];
        setInsights(updated);
        return updated.some((insight) => insight.status === "analyzing");
      },
      onError: (error) => {
        showError(localizeErrorMessage(
          error instanceof Error ? error.message : "Could not refresh insights",
          locale,
        ));
      },
    });
  }, [hasAnalyzingInsights, loading, locale, selectedProjectId, showError, user]);

  useEffect(() => {
    if (!menuInsightId) return;
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (!insightMenuRef.current?.contains(event.target as Node)) setMenuInsightId(null);
    };
    document.addEventListener("pointerdown", closeOnOutsideClick);
    return () => document.removeEventListener("pointerdown", closeOnOutsideClick);
  }, [menuInsightId]);

  const visibleInsights = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase(locale);
    const filtered = insights.filter((insight) => {
      if (status !== "all" && insight.status !== status) return false;
      if (!normalizedQuery) return true;
      return [
        insight.ai_analysis?.product_name,
        insight.title,
        insight.filename,
        insight.project_title,
        insight.ai_analysis?.product_summary,
      ].join(" ").toLocaleLowerCase(locale).includes(normalizedQuery);
    });
    return [...filtered].sort((left, right) => {
      if (sort === "name") {
        return (left.title || left.filename).localeCompare(
          right.title || right.filename,
          locale,
        );
      }
      const difference = insightTimestamp(left.upload_time) - insightTimestamp(right.upload_time);
      return sort === "oldest" ? difference : -difference;
    });
  }, [insights, locale, query, sort, status]);
  const paginationResetKey = JSON.stringify([query, status, sort, selectedProjectId]);
  const pagination = usePagination(visibleInsights, paginationResetKey, 12);

  useEffect(() => {
    setMenuInsightId(null);
  }, [pagination.page, pagination.pageSize, paginationResetKey]);

  const openCreateDialog = () => {
    if (!projectId && projects[0]) setProjectId(projects[0].id);
    setMode("files");
    setFiles([]);
    setFilesExpanded(false);
    setRepoUrl("");
    setManualName("");
    dialogRef.current?.showModal();
  };

  const deleteInsight = async () => {
    if (!pendingDeleteInsight) return;
    const target = pendingDeleteInsight;
    setPendingDeleteInsight(null);
    setDeletingInsight(true);
    try {
      await delete_history_item(target.id);
      setInsights((current) => current.filter((item) => item.id !== target.id));
      showSuccess(t("洞察已删除", "Insight deleted"));
    } catch (error) {
      showError(localizeErrorMessage(error instanceof Error ? error.message : "Could not delete insight", locale));
    } finally {
      setDeletingInsight(false);
    }
  };

  const openRenameDialog = (insight: HistoryRecord) => {
    setMenuInsightId(null);
    setRenamingInsight(insight);
    setRenameName(insight.title || insight.filename);
    renameDialogRef.current?.showModal();
  };

  const renameInsight = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (renaming) { showWarning(t("正在处理中，请稍候。", "Please wait for the current operation to finish.")); return; }
    if (!renamingInsight || !canManageInsight(user, renamingInsight) || renamingInsight.status === "analyzing") {
      showWarning(t("仅创建者、项目所有者或项目管理员可重命名未在分析中的洞察", "Only the creator, project owner or project administrator can rename an insight that is not being analyzed."));
      return;
    }
    const nextName = renameName.trim();
    if (!nextName) {
      showError(t("洞察名称不能为空", "Insight name is required"));
      return;
    }
    setRenaming(true);
    try {
      const response = await rename_history_item(renamingInsight.id, nextName);
      setInsights((current) => current.map((item) => item.id === response.data.id ? response.data : item));
      renameDialogRef.current?.close();
      setRenamingInsight(null);
      showSuccess(t("洞察名称已更新", "Insight name updated"));
    } catch (error) {
      showError(localizeErrorMessage(error instanceof Error ? error.message : "Could not rename insight", locale));
    } finally {
      setRenaming(false);
    }
  };

  const appendFiles = (selectedFiles: File[]) => {
    const merged = [...files];
    const duplicateNames: string[] = [];
    for (const file of selectedFiles) {
      const duplicate = merged.some((existing) => (
        existing.name === file.name
        && existing.size === file.size
        && existing.lastModified === file.lastModified
      ));
      if (duplicate) duplicateNames.push(file.name);
      else merged.push(file);
    }
    if (duplicateNames.length > 0) {
      showWarning(t(
        "已忽略重复选择的文件：{names}",
        "Duplicate files were ignored: {names}",
        { names: duplicateNames.join("、") },
      ));
    }
    if (merged.length > 5) {
      showError(t("最多只能选择 5 个文件", "You can select up to 5 files"));
    }
    const nextFiles = merged.slice(0, 5);
    setFiles(nextFiles);
    setFilesExpanded(false);
  };

  const createInsight = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (creating) { showWarning(creatingReason); return; }
    if (!projectId) {
      showError(t("必须选择所属项目", "A project is required"));
      return;
    }
    setCreating(true);
    try {
      let recordId = "";
      if (mode === "files") {
        if (files.length === 0) throw new Error(t("请选择至少一个资料文件", "Select at least one source file"));
        const response = await parse_files(files, projectId, locale);
        recordId = response.data?.record_id || "";
      } else if (mode === "repo") {
        if (!repoUrl.trim()) throw new Error(t("请输入仓库地址", "Repository URL is required"));
        const response = await parse_repo(repoUrl.trim(), projectId, locale);
        recordId = response.data?.record_id || "";
      } else {
        if (!manualName.trim()) throw new Error(t("请输入洞察名称", "Insight name is required"));
        const response = await create_manual_insight({
          ...EMPTY_ANALYSIS,
          product_name: manualName.trim(),
        }, projectId);
        recordId = response.data.id;
      }
      dialogRef.current?.close();
      showSuccess(t("洞察已创建", "Insight created"));
      if (recordId) router.push(`/market_insight/${encodeURIComponent(recordId)}`);
    } catch (error) {
      showError(localizeErrorMessage(error instanceof Error ? error.message : "Could not create insight", locale));
    } finally {
      setCreating(false);
    }
  };

  if (authLoading || !user) {
    return <div className="amp-page-state" role="status">{t(CHINESE_PROGRESS.loading, ENGLISH_PROGRESS.loading)}</div>;
  }

  const projectOptions = projects.map((project) => ({ value: project.id, label: project.title }));
  const statusLabel = (value: string) => {
    if (value === "analyzing") return t("分析中", "Analyzing");
    if (value === "failed") return t("失败", "Failed");
    return t("已完成", "Completed");
  };

  return (
    <div className="amp-projects-layout">
      <InsightProjectSidebar projects={projects} selectedProjectId={selectedProjectId} />
      <main className="amp-projects-main">
        <div className="amp-projects-header">
          <div>
            <h1 className="amp-module-title">{t("市场洞察", "Market insights")}</h1>
            <p>{selectedProjectId
              ? t("查看当前项目中的市场洞察。", "View market insights in the selected project.")
              : t("汇总当前组织所有可访问项目中的洞察。", "Insights across all accessible projects in this organization.")}</p>
          </div>
          <button type="button" className="amp-button amp-button-primary" onClick={openCreateDialog}>
            {t(CHINESE_ACTIONS.create, ENGLISH_ACTIONS.create)}
          </button>
        </div>

        <div className="amp-insight-toolbar">
          <div className="amp-projects-search">
            <RedesignInput
              leftIcon={<InlineIcon name="search" className="h-4 w-4" />}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("搜索洞察", "Search insights")}
              aria-label={t("搜索洞察", "Search insights")}
            />
          </div>
          <EnterpriseSelect
            value={status}
            options={[
              { value: "all", label: t("全部状态", "All statuses") },
              { value: "analyzing", label: t("分析中", "Analyzing") },
              { value: "completed", label: t("已完成", "Completed") },
              { value: "failed", label: t("失败", "Failed") },
            ]}
            onChange={setStatus}
            ariaLabel={t("洞察状态", "Insight status")}
            className="w-36"
          />
          <EnterpriseSelect
            value={sort}
            options={[
              { value: "latest", label: t("最近更新", "Latest") },
              { value: "oldest", label: t("最早创建", "Oldest") },
              { value: "name", label: t("洞察名称", "Insight name") },
            ]}
            onChange={setSort}
            ariaLabel={t("洞察排序", "Insight sorting")}
            className="w-40"
          />
        </div>

        {loading ? (
          <div className="amp-projects-state" role="status">{t(CHINESE_PROGRESS.loading, ENGLISH_PROGRESS.loading)}</div>
        ) : visibleInsights.length === 0 ? (
          <div className="amp-projects-state">
            <span className="amp-projects-empty-icon"><InlineIcon name="insight" /></span>
            <strong>{query ? t("没有匹配的洞察", "No matching insights") : t("暂无市场洞察", "No market insights yet")}</strong>
            <p>{projects.length === 0
              ? t("请先创建项目，再为项目创建洞察。", "Create a project before creating an insight.")
              : t("创建洞察并上传产品资料，获得结构化营销建议。", "Create an insight and upload source material for structured recommendations.")}</p>
          </div>
        ) : (
          <>
          <div className="amp-insight-grid">
            {pagination.pageItems.map((insight) => {
              const name = insight.title || insight.filename;
              const summary = insight.ai_analysis?.product_summary
                || insight.ai_analysis?.product_description
                || t("暂无洞察摘要", "No insight summary");
              return (
                <article key={insight.id} className="amp-insight-card">
                  <Link href={`/market_insight/${encodeURIComponent(insight.id)}`} className="amp-insight-card-link">
                    <span className="amp-insight-card-body">
                      <span className="amp-insight-card-heading">
                        <strong>{name}</strong>
                      </span>
                      <span className="amp-insight-card-summary">{summary}</span>
                      <span className="amp-insight-card-meta">
                        <span>{insight.project_title}</span>
                        <span className={`amp-insight-status amp-insight-status-${insight.status}`}>{statusLabel(insight.status)}</span>
                        <span className="amp-asset-creator">{insight.creator_name || t("未知创建者", "Unknown creator")}</span>
                      </span>
                    </span>
                  </Link>
                  <div ref={menuInsightId === insight.id ? insightMenuRef : undefined} className="amp-insight-card-menu">
                    <button type="button" className="amp-insight-card-more"
                      aria-label={t("{name} 洞察操作", "Actions for {name}", { name })}
                      aria-haspopup="menu" aria-expanded={menuInsightId === insight.id}
                      onClick={() => setMenuInsightId((current) => current === insight.id ? null : insight.id)}>
                      <InlineIcon name="more" strokeWidth={3} />
                    </button>
                    {menuInsightId === insight.id && (
                      <div role="menu" className="amp-insight-card-popover">
                        <GuardedButton type="button" role="menuitem"
                          disabled={!canManageInsight(user, insight) || insight.status === "analyzing"}
                          blockedReason={!canManageInsight(user, insight)
                            ? t("仅创建者、项目所有者或项目管理员可重命名此洞察", "Only the creator, project owner or project administrator can rename this insight.")
                            : t("洞察正在分析，完成后才能重命名", "Analysis must finish before renaming.")}
                          onClick={() => openRenameDialog(insight)}>
                          <InlineIcon name="edit" />{t(CHINESE_ACTIONS.rename, ENGLISH_ACTIONS.rename)}
                        </GuardedButton>
                        <GuardedButton type="button" role="menuitem" className="amp-insight-card-delete"
                          disabled={!canManageInsight(user, insight)}
                          blockedReason={t("仅创建者、项目所有者或项目管理员可删除此洞察", "Only the creator, project owner or project administrator can delete this insight.")}
                          onClick={() => { setMenuInsightId(null); setPendingDeleteInsight(insight); }}>
                          <InlineIcon name="trash" />{t(CHINESE_ACTIONS.delete, ENGLISH_ACTIONS.delete)}
                        </GuardedButton>
                      </div>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
          <Pagination page={pagination.page} pageSize={pagination.pageSize}
            pageSizeOptions={DEFAULT_PAGE_SIZE_OPTIONS}
            totalItems={pagination.totalItems} totalPages={pagination.totalPages}
            onPageChange={pagination.setPage} onPageSizeChange={pagination.setPageSize} />
          </>
        )}
      </main>

      <dialog ref={dialogRef} aria-labelledby="create-insight-title"
        className="amp-workspace-dialog amp-insight-create-dialog m-auto w-[calc(100%_-_32px)] max-w-2xl bg-white p-6 text-slate-950 backdrop:bg-slate-950/40"
        onCancel={(event) => {
          if (creating) { event.preventDefault(); showWarning(creatingReason); }
        }}>
        <h2 id="create-insight-title" className="text-xl font-semibold">{t("创建市场洞察", "Create market insight")}</h2>
        <p className="mt-1 text-sm text-slate-500">{t("每条洞察必须归属于一个项目。", "Every insight must belong to a project.")}</p>
        <form className="mt-6" onSubmit={createInsight}>
          <label className="mb-2 block text-sm font-medium">{t("所属项目", "Project")}</label>
          <EnterpriseSelect
            value={projectId}
            options={projectOptions}
            onChange={setProjectId}
            ariaLabel={t("选择所属项目", "Select project")}
            placeholder={t("暂无可用项目", "No projects available")}
            disabled={creating || projects.length === 0}
            disabledReason={creating ? creatingReason : t("请先创建项目。", "Create a project first.")}
            className="w-full"
          />

          <div className="amp-insight-create-modes" role="tablist">
            {([
              ["files", t(CHINESE_ACTIONS.upload, ENGLISH_ACTIONS.upload), "upload"],
              ["repo", t("仓库", "Repository"), "github-image"],
              ["manual", t("手动", "Manual"), "edit"],
            ] as Array<[CreateMode, string, "upload" | "github-image" | "edit"]>).map(([value, label, icon]) => (
              <button key={value} type="button" role="tab" aria-selected={mode === value}
                onClick={() => setMode(value)}>
                {icon === "github-image" ? (
                  <Image src="/assets/brand/github-mark.png" alt="" width={16} height={16} unoptimized />
                ) : (
                  <InlineIcon name={icon} />
                )}
                {label}
              </button>
            ))}
          </div>

          <div className="amp-insight-create-panel">
            {mode === "files" && (
              <label className="amp-insight-upload" role="button" tabIndex={creating ? 0 : undefined}
                aria-disabled={uploadInteraction["aria-disabled"]}
                data-blocked-action={uploadInteraction["data-blocked-action"]}
                onClickCapture={uploadInteraction.onClickCapture}
                onKeyDownCapture={uploadInteraction.onKeyDownCapture}>
                <InlineIcon name="upload" />
                <strong>{t("选择产品资料", `${ENGLISH_ACTIONS.select} files`)}</strong>
                <span>{t("支持 PDF、DOCX 和 Markdown，最多 5 个文件", "PDF, DOCX, and Markdown; up to 5 files")}</span>
                <input type="file" multiple accept=".pdf,.docx,.md,.markdown" disabled={creating}
                  style={{ pointerEvents: creating ? "none" : undefined }}
                  onChange={(event) => {
                    appendFiles(Array.from(event.target.files || []));
                    event.currentTarget.value = "";
                  }} />
              </label>
            )}
            {mode === "repo" && (
              <label>
                <span>{t("仓库地址", "Repository URL")}</span>
                <GuardedInput className="amp-workspace-control mt-2 w-full" value={repoUrl} disabled={creating} blockedReason={creatingReason}
                  onChange={(event) => setRepoUrl(event.target.value)}
                  placeholder="https://github.com/owner/repository" />
              </label>
            )}
            {mode === "manual" && (
              <label><span>{t("洞察名称", "Insight name")}</span>
                <GuardedInput className="amp-workspace-control mt-2 w-full" value={manualName} disabled={creating} blockedReason={creatingReason}
                  autoFocus maxLength={120}
                  onChange={(event) => setManualName(event.target.value)}
                  placeholder={t("输入洞察名称", "Enter an insight name")} /></label>
            )}
          </div>

          <div className="amp-insight-create-actions">
            {mode === "files" && files.length > 0 && (
              <div ref={selectedFilesRef} className="amp-insight-selected-files">
                <button type="button" className="amp-insight-selected-files-toggle"
                  aria-expanded={filesExpanded} onClick={() => setFilesExpanded((current) => !current)}>
                  <span>{t("已选择 {count} 个文件", "{count} files selected", { count: files.length })}</span>
                  <InlineIcon name="chevronRight" className={filesExpanded ? "is-expanded" : ""} />
                </button>
                {filesExpanded && (
                  <ul>
                    {files.map((file, index) => (
                      <li key={`${file.name}-${file.size}-${file.lastModified}-${index}`}>
                        <span className="amp-insight-selected-file-copy">
                          <span className="amp-insight-selected-file-name" title={file.name}>{file.name}</span>
                          <small>{(file.size / 1024).toFixed(1)} KB</small>
                        </span>
                        <GuardedButton type="button" disabled={creating} blockedReason={creatingReason}
                          aria-label={t("移除文件：{name}", "Remove file: {name}", { name: file.name })}
                          onClick={() => {
                            setFiles((current) => current.filter((_, currentIndex) => currentIndex !== index));
                            if (files.length === 1) setFilesExpanded(false);
                          }}>
                          <InlineIcon name="close" />
                        </GuardedButton>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
            <div className="amp-insight-create-action-buttons">
              <GuardedButton type="button" className="amp-button amp-button-secondary amp-button-cancel" disabled={creating} blockedReason={creatingReason}
                onClick={() => dialogRef.current?.close()}>{t(CHINESE_ACTIONS.cancel, ENGLISH_ACTIONS.cancel)}</GuardedButton>
              <GuardedButton type="submit" className="amp-button amp-button-primary" disabled={creating || !projectId}
                blockedReason={creating ? creatingReason : t("请选择所属项目", "Select a project first.")}>
                {creating ? t(CHINESE_PROGRESS.creating, ENGLISH_PROGRESS.creating) : t(CHINESE_ACTIONS.create, ENGLISH_ACTIONS.create)}
              </GuardedButton>
            </div>
          </div>
        </form>
      </dialog>
      <DeleteConfirmDialog
        open={Boolean(pendingDeleteInsight)}
        title={t("删除洞察", "Delete insight")}
        message={t(
          "确定删除「{name}」吗？删除后无法恢复。",
          "Delete “{name}”? This action cannot be undone.",
          { name: pendingDeleteInsight?.title || pendingDeleteInsight?.filename || "" },
        )}
        cancelLabel={t(CHINESE_ACTIONS.cancel, ENGLISH_ACTIONS.cancel)}
        confirmLabel={t(CHINESE_ACTIONS.delete, ENGLISH_ACTIONS.delete)}
        busyLabel={t(CHINESE_PROGRESS.deleting, ENGLISH_PROGRESS.deleting)}
        busy={deletingInsight}
        onCancel={() => setPendingDeleteInsight(null)}
        onConfirm={() => void deleteInsight()}
      />
      <dialog ref={renameDialogRef} aria-labelledby="rename-overview-insight-title"
        className="amp-workspace-dialog m-auto w-[calc(100%_-_32px)] max-w-md bg-white p-6 text-slate-950 backdrop:bg-slate-950/40"
        onCancel={(event) => {
          if (renaming) {
            event.preventDefault();
            showWarning(t("正在处理中，请稍候。", "Please wait for the current operation to finish."));
          }
        }}
        onClose={() => { if (!renaming) setRenamingInsight(null); }}>
        <h2 id="rename-overview-insight-title" className="text-lg font-semibold">{t("重命名洞察", "Rename insight")}</h2>
        <form className="mt-5" onSubmit={renameInsight}>
          <label htmlFor="rename-overview-insight-name" className="mb-2 block text-sm font-medium">{t("洞察名称", "Insight name")}</label>
          <GuardedInput id="rename-overview-insight-name" autoFocus required maxLength={120}
            className="amp-workspace-control w-full" value={renameName} disabled={renaming}
            blockedReason={t("正在处理中，请稍候。", "Please wait for the current operation to finish.")}
            onChange={(event) => setRenameName(event.target.value)} />
          <div className="mt-6 flex justify-end gap-3">
            <GuardedButton type="button" className="amp-button amp-button-secondary amp-button-cancel" disabled={renaming}
              blockedReason={t("正在处理中，请稍候。", "Please wait for the current operation to finish.")}
              onClick={() => renameDialogRef.current?.close()}>{t(CHINESE_ACTIONS.cancel, ENGLISH_ACTIONS.cancel)}</GuardedButton>
            <GuardedButton type="submit" className="amp-button amp-button-primary" disabled={renaming || !renameName.trim()}
              blockedReason={renaming ? t("正在处理中，请稍候。", "Please wait for the current operation to finish.") : t("请输入洞察名称", "Enter an insight name.")}>
              {renaming ? t(CHINESE_PROGRESS.saving, ENGLISH_PROGRESS.saving) : t(CHINESE_ACTIONS.save, ENGLISH_ACTIONS.save)}
            </GuardedButton>
          </div>
        </form>
      </dialog>
    </div>
  );
}

export default function MarketInsightPage() {
  return (
    <Suspense fallback={<div className="amp-page-state" role="status">Loading...</div>}>
      <MarketInsightOverview />
    </Suspense>
  );
}
