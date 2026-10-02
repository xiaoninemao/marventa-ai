"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/contexts/auth_context";
import { useI18n } from "@/contexts/i18n_context";
import { ENGLISH_ACTIONS, ENGLISH_PROGRESS, CHINESE_PROGRESS, CHINESE_ACTIONS } from "@/i18n/interaction_copy";
import { useToast } from "@/contexts/toast_context";
import { localizeErrorMessage } from "@/i18n/errors";
import InlineIcon from "@/components/redesign/InlineIcon";
import { GuardedButton, GuardedInput } from "@/components/redesign/GuardedControls";
import EnterpriseSelect from "@/components/redesign/EnterpriseSelect";
import RedesignInput from "@/components/redesign/RedesignInput";
import DeleteConfirmDialog from "@/components/redesign/DeleteConfirmDialog";
import Pagination from "@/components/redesign/Pagination";
import PortfolioProjectSidebar from "@/components/portfolio/PortfolioProjectSidebar";
import {
  delete_script,
  fetch_content_projects,
  fetch_scripts,
  update_script,
} from "@/services/api_client";
import type { PortfolioScript } from "@/types/portfolio";
import type { ContentProject } from "@/types/publishing";
import { parsePortfolioReport } from "@/utils/portfolio_report";
import { DEFAULT_PAGE_SIZE_OPTIONS, usePagination } from "@/utils/pagination";

const PENDING_DOCUMENTS_STORAGE_KEY = "amp-content-generator-pending-documents-v1";
type WorkStatusFilter = "all" | PortfolioScript["status"];

function readPendingDocumentSessions(): string[] {
  try {
    const raw = window.localStorage.getItem(PENDING_DOCUMENTS_STORAGE_KEY);
    return raw ? JSON.parse(raw) as string[] : [];
  } catch {
    return [];
  }
}

function writePendingDocumentSessions(sessionIds: string[]) {
  if (sessionIds.length > 0) {
    window.localStorage.setItem(PENDING_DOCUMENTS_STORAGE_KEY, JSON.stringify(sessionIds));
  } else {
    window.localStorage.removeItem(PENDING_DOCUMENTS_STORAGE_KEY);
  }
}

function PortfolioOverview() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, loading: authLoading } = useAuth();
  const { t, locale } = useI18n();
  const { showError, showSuccess } = useToast();
  const menuRef = useRef<HTMLDivElement>(null);
  const renameDialogRef = useRef<HTMLDialogElement>(null);
  const [projects, setProjects] = useState<ContentProject[]>([]);
  const [scripts, setScripts] = useState<PortfolioScript[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<WorkStatusFilter>("all");
  const [sort, setSort] = useState<"latest" | "oldest" | "name">("latest");
  const [menuScriptId, setMenuScriptId] = useState<string | null>(null);
  const [renamingScript, setRenamingScript] = useState<PortfolioScript | null>(null);
  const [renameName, setRenameName] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<PortfolioScript | null>(null);
  const [deleting, setDeleting] = useState(false);
  const selectedProjectId = searchParams.get("project") || "";

  useEffect(() => {
    if (!authLoading && !user) router.replace("/");
  }, [authLoading, router, user]);

  const loadPortfolio = useCallback(async () => {
    const [projectsResponse, scriptsResponse] = await Promise.all([
      fetch_content_projects(),
      fetch_scripts(selectedProjectId),
    ]);
    setProjects(projectsResponse.data || []);
    setScripts(scriptsResponse.data || []);
  }, [selectedProjectId]);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    setLoading(true);
    loadPortfolio()
      .catch((error) => {
        if (!cancelled) {
          showError(localizeErrorMessage(error instanceof Error ? error.message : "Could not load portfolio", locale));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [loadPortfolio, locale, showError, user]);

  useEffect(() => {
    if (!menuScriptId) return;
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuScriptId(null);
    };
    document.addEventListener("pointerdown", closeOnOutsideClick);
    return () => document.removeEventListener("pointerdown", closeOnOutsideClick);
  }, [menuScriptId]);

  useEffect(() => {
    if (!user || (
      readPendingDocumentSessions().length === 0
      && !scripts.some((script) => script.status === "generating")
    )) return;
    let pollCount = 0;
    const timer = window.setInterval(async () => {
      try {
        const response = await fetch_scripts(selectedProjectId);
        setScripts(response.data);
        const pending = readPendingDocumentSessions();
        const completed = pending.filter((sessionId) => response.data.some((script) => (
          script.source_session_id === sessionId && script.status === "completed"
        )));
        const failed = pending.filter((sessionId) => response.data.some((script) => (
          script.source_session_id === sessionId && script.status === "failed"
        )));
        const finished = new Set([...completed, ...failed]);
        const remaining = pending.filter((sessionId) => !finished.has(sessionId));
        if (remaining.length !== pending.length) {
          writePendingDocumentSessions(remaining);
          if (completed.length > 0) {
            showSuccess(t("作品已生成并保存到作品集", "Your work is ready and saved to Portfolio."));
          }
          if (failed.length > 0) {
            showError(t("作品生成失败，请返回智能创作重试", "Work generation failed. Return to Content Studio to retry."));
          }
        }
        if (remaining.length === 0 && !response.data.some((script) => script.status === "generating")) {
          window.clearInterval(timer);
        }
      } catch (error) {
        window.clearInterval(timer);
        showError(localizeErrorMessage(
          error instanceof Error ? error.message : "Could not refresh portfolio",
          locale,
        ));
      }
      pollCount += 1;
      if (pollCount >= 40) window.clearInterval(timer);
    }, 3000);
    return () => window.clearInterval(timer);
  }, [locale, scripts, selectedProjectId, showError, showSuccess, t, user]);

  const visibleScripts = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase(locale);
    const filtered = scripts.filter((script) => {
      if (status !== "all" && script.status !== status) return false;
      if (!normalizedQuery) return true;
      const report = parsePortfolioReport(script.title, script.content, script.updated_at, t, locale);
      return [script.title, script.project_title, report.summary]
        .join(" ")
        .toLocaleLowerCase(locale)
        .includes(normalizedQuery);
    });
    return [...filtered].sort((left, right) => {
      if (sort === "name") return left.title.localeCompare(right.title, locale);
      const difference = new Date(left.updated_at).getTime() - new Date(right.updated_at).getTime();
      return sort === "oldest" ? difference : -difference;
    });
  }, [locale, query, scripts, sort, status, t]);
  const paginationResetKey = JSON.stringify([query, status, sort, selectedProjectId, locale]);
  const pagination = usePagination(visibleScripts, paginationResetKey, 12);

  useEffect(() => {
    setMenuScriptId(null);
  }, [pagination.page, pagination.pageSize, paginationResetKey]);

  const canManage = (script: PortfolioScript) => Boolean(user && (
    script.user_id === user.id
    || script.project_role === "owner"
    || script.project_role === "admin"
  ));
  const busyReason = deleting ? t("正在删除作品，请稍候。", "A work is being deleted. Please wait.")
    : t("作品名称正在保存，请稍候。", "The work name is being saved. Please wait.");
  const permissionReason = t("仅作品创建者和项目管理员可以重命名或删除作品。", "Only the work creator and project managers can rename or delete this work.");
  const currentRename = scripts.find((script) => script.id === renamingScript?.id);
  const renameLocked = renaming || deleting || !currentRename || !canManage(currentRename);
  const renameReason = renaming || deleting ? busyReason : !currentRename
    ? t("此作品已不可用，请刷新列表。", "This work is unavailable. Refresh the list.") : permissionReason;

  const openRenameDialog = (script: PortfolioScript) => {
    if (renaming || deleting || !canManage(script)) { showError(renaming || deleting ? busyReason : permissionReason); return; }
    setMenuScriptId(null);
    setRenamingScript(script);
    setRenameName(script.title);
    renameDialogRef.current?.showModal();
  };

  const renameScript = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!renamingScript || renameLocked) { showError(renameReason); return; }
    const title = renameName.trim();
    if (!title) {
      showError(t("作品名称不能为空", "Work name is required"));
      return;
    }
    setRenaming(true);
    try {
      const response = await update_script(renamingScript.id, { title });
      setScripts((current) => current.map((script) => (
        script.id === renamingScript.id
          ? { ...response.data, project_title: script.project_title, project_role: script.project_role }
          : script
      )));
      renameDialogRef.current?.close();
      setRenamingScript(null);
      showSuccess(t("作品已重命名", "Work renamed"));
    } catch (error) {
      showError(localizeErrorMessage(error instanceof Error ? error.message : "Could not rename work", locale));
    } finally {
      setRenaming(false);
    }
  };

  const deleteScript = async () => {
    if (!pendingDelete) return;
    const current = scripts.find((script) => script.id === pendingDelete.id);
    if (renaming || deleting || !current || !canManage(current)) {
      showError(renaming || deleting ? busyReason : permissionReason); return;
    }
    const target = pendingDelete;
    setPendingDelete(null);
    setDeleting(true);
    try {
      await delete_script(target.id);
      setScripts((current) => current.filter((script) => script.id !== target.id));
      showSuccess(t("作品已删除", "Work deleted"));
    } catch (error) {
      showError(localizeErrorMessage(error instanceof Error ? error.message : "Could not delete work", locale));
    } finally {
      setDeleting(false);
    }
  };

  if (authLoading || !user) {
    return <div className="amp-page-state" role="status">{t(CHINESE_PROGRESS.loading, ENGLISH_PROGRESS.loading)}</div>;
  }

  return (
    <div className="amp-projects-layout">
      <PortfolioProjectSidebar projects={projects} selectedProjectId={selectedProjectId} />
      <main className="amp-projects-main">
        <div className="amp-projects-header">
          <div>
            <h1 className="amp-module-title">{t("作品集", "Portfolio")}</h1>
            <p>{selectedProjectId
              ? t("查看当前项目中的作品。", "View work in the selected project.")
              : t("汇总当前组织所有可访问项目中的作品。", "Work across all accessible projects in this organization.")}</p>
          </div>
        </div>

        <div className="amp-insight-toolbar">
          <div className="amp-projects-search">
            <RedesignInput
              leftIcon={<InlineIcon name="search" className="h-4 w-4" />}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("搜索作品", "Search portfolio")}
              aria-label={t("搜索作品", "Search portfolio")}
            />
          </div>
          <EnterpriseSelect
            value={status}
            options={[
              { value: "all", label: t("全部状态", "All statuses") },
              { value: "generating", label: t("生成中", "Generating") },
              { value: "completed", label: t("已完成", "Completed") },
              { value: "failed", label: t("失败", "Failed") },
            ]}
            onChange={setStatus}
            ariaLabel={t("作品状态", "Work status")}
            className="w-36"
          />
          <EnterpriseSelect
            value={sort}
            options={[
              { value: "latest", label: t("最近更新", "Latest") },
              { value: "oldest", label: t("最早创建", "Oldest") },
              { value: "name", label: t("作品名称", "Work name") },
            ]}
            onChange={setSort}
            ariaLabel={t("作品排序", "Portfolio sorting")}
            className="w-40"
          />
        </div>

        {loading ? (
          <div className="amp-projects-state" role="status">{t("正在加载作品...", "Loading portfolio...")}</div>
        ) : visibleScripts.length === 0 ? (
          <div className="amp-projects-state">
            <span className="amp-projects-empty-icon"><InlineIcon name="briefcase" /></span>
            <strong>{query ? t("没有匹配的作品", "No matching work") : t("暂无作品", "No work yet")}</strong>
            <p>{query
              ? t("请尝试其他搜索关键词。", "Try a different search term.")
              : t("在智能创作中生成作品后，内容会自动保存到这里。", "Work generated in Content Studio is saved here automatically.")}</p>
          </div>
        ) : (
          <>
          <div className="amp-insight-grid">
            {pagination.pageItems.map((script) => {
              const report = parsePortfolioReport(script.title, script.content, script.updated_at, t, locale);
              const projectTitle = script.project_title
                || projects.find((project) => project.id === script.project_id)?.title
                || t("未关联项目", "No project");
              const statusClass = script.status === "generating" ? "analyzing" : script.status;
              const statusLabel = script.status === "generating"
                ? t("生成中", "Generating")
                : script.status === "failed"
                  ? t("失败", "Failed")
                  : t("已完成", "Completed");
              return (
                <article key={script.id} className="amp-portfolio-card">
                  <Link href={`/portfolio/${encodeURIComponent(script.id)}`} className="amp-portfolio-card-link">
                    <span className="amp-portfolio-card-preview" aria-hidden="true">
                      <small>MARVENTA AI</small>
                      <strong>{script.status === "generating"
                        ? t("正在生成作品内容", "Generating work content")
                        : script.status === "failed"
                          ? t("作品生成失败", "Work generation failed")
                          : report.title}</strong>
                      <i />
                      <i />
                    </span>
                    <span className="amp-portfolio-card-footer">
                      <strong title={script.title}>{script.title}</strong>
                      <span className="amp-insight-card-meta">
                        <span>{projectTitle}</span>
                        <span className={`amp-insight-status amp-insight-status-${statusClass}`}>{statusLabel}</span>
                        <span className="amp-asset-creator">{script.creator_name || t("未知创建者", "Unknown creator")}</span>
                      </span>
                    </span>
                  </Link>
                  <div ref={menuScriptId === script.id ? menuRef : undefined} className="amp-insight-card-menu">
                    <button type="button" className="amp-insight-card-more"
                      aria-label={t("{name} 作品操作", "Actions for {name}", { name: script.title })}
                      aria-haspopup="menu" aria-expanded={menuScriptId === script.id}
                      onClick={() => setMenuScriptId((current) => current === script.id ? null : script.id)}>
                      <InlineIcon name="more" strokeWidth={3} />
                    </button>
                    {menuScriptId === script.id && (
                      <div role="menu" className="amp-insight-card-popover">
                        <GuardedButton blockedReason={renaming || deleting ? busyReason : permissionReason} type="button" role="menuitem" disabled={renaming || deleting || !canManage(script)}
                          onClick={() => openRenameDialog(script)}>
                          <InlineIcon name="edit" />{t(CHINESE_ACTIONS.rename, ENGLISH_ACTIONS.rename)}
                        </GuardedButton>
                        <GuardedButton blockedReason={renaming || deleting ? busyReason : permissionReason} type="button" role="menuitem" className="amp-insight-card-delete"
                          disabled={renaming || deleting || !canManage(script)}
                          onClick={() => { setMenuScriptId(null); setPendingDelete(script); }}>
                          <InlineIcon name="trash" />{t(CHINESE_ACTIONS.delete, ENGLISH_ACTIONS.delete)}
                        </GuardedButton>
                      </div>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
          {pagination.totalItems > 0 && <Pagination
            page={pagination.page}
            pageSize={pagination.pageSize}
            pageSizeOptions={DEFAULT_PAGE_SIZE_OPTIONS}
            totalItems={pagination.totalItems}
            totalPages={pagination.totalPages}
            onPageChange={pagination.setPage}
            onPageSizeChange={pagination.setPageSize} />}
          </>
        )}
      </main>

      <dialog ref={renameDialogRef} aria-labelledby="rename-work-title"
        className="amp-workspace-dialog m-auto w-[calc(100%_-_32px)] max-w-md bg-white p-6 text-slate-950 backdrop:bg-slate-950/40"
        onCancel={(event) => { if (renaming) { event.preventDefault(); showError(busyReason); } else setRenamingScript(null); }}>
        <form onSubmit={(event) => void renameScript(event)}>
          <h2 id="rename-work-title" className="text-lg font-semibold">{t("重命名作品", "Rename work")}</h2>
          <label className="mt-5 block">
            <span className="mb-2 block text-sm font-medium">{t("作品名称", "Work name")}</span>
            <GuardedInput blockedReason={renameReason} disabled={renameLocked} className="amp-workspace-control w-full" value={renameName} onChange={(event) => setRenameName(event.target.value)} autoFocus />
          </label>
          <div className="mt-6 flex justify-end gap-2">
            <GuardedButton blockedReason={busyReason} type="button" className="amp-button amp-button-secondary amp-button-cancel" disabled={renaming}
              onClick={() => { renameDialogRef.current?.close(); setRenamingScript(null); }}>
              {t(CHINESE_ACTIONS.cancel, ENGLISH_ACTIONS.cancel)}
            </GuardedButton>
            <GuardedButton blockedReason={renameLocked ? renameReason : t("请输入作品名称。", "Enter a work name.")} type="submit" className="amp-button amp-button-primary" disabled={renameLocked || !renameName.trim()}>
              {renaming ? t(CHINESE_PROGRESS.saving, ENGLISH_PROGRESS.saving) : t(CHINESE_ACTIONS.save, ENGLISH_ACTIONS.save)}
            </GuardedButton>
          </div>
        </form>
      </dialog>

      <DeleteConfirmDialog
        open={Boolean(pendingDelete)}
        title={t("删除作品", "Delete work")}
        message={t("删除后将无法恢复，确认删除“{title}”吗？", "This cannot be undone. Delete “{title}”?", { title: pendingDelete?.title || "" })}
        cancelLabel={t(CHINESE_ACTIONS.cancel, ENGLISH_ACTIONS.cancel)}
        confirmLabel={t(CHINESE_ACTIONS.delete, ENGLISH_ACTIONS.delete)}
        busyLabel={t(CHINESE_PROGRESS.deleting, ENGLISH_PROGRESS.deleting)}
        busy={deleting}
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => void deleteScript()}
      />
    </div>
  );
}

export default function PortfolioPage() {
  return (
    <Suspense fallback={<div className="amp-page-state" role="status">Loading...</div>}>
      <PortfolioOverview />
    </Suspense>
  );
}
