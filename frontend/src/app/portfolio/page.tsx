"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import Image from "next/image";
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
import PortfolioEmptyPreview from "@/components/portfolio/PortfolioEmptyPreview";
import {
  create_portfolio_work,
  delete_script,
  fetch_content_projects,
  fetch_scripts,
  update_script,
} from "@/services/api_client";
import type { PortfolioScript } from "@/types/portfolio";
import type { ContentProject } from "@/types/publishing";
import { DEFAULT_PAGE_SIZE_OPTIONS, usePagination } from "@/utils/pagination";
import { portfolioWorkStatus, type PortfolioWorkStatus } from "@/utils/portfolio_status";

type WorkStatusFilter = "all" | PortfolioWorkStatus;

function PortfolioOverview() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, loading: authLoading } = useAuth();
  const { t, locale } = useI18n();
  const { showError, showSuccess } = useToast();
  const menuRef = useRef<HTMLDivElement>(null);
  const renameDialogRef = useRef<HTMLDialogElement>(null);
  const createDialogRef = useRef<HTMLDialogElement>(null);
  const [newKind, setNewKind] = useState<"image" | "video" | "">("");
  const [newProjectId, setNewProjectId] = useState("");
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [projects, setProjects] = useState<ContentProject[]>([]);
  const [scripts, setScripts] = useState<PortfolioScript[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<WorkStatusFilter>("all");
  const [typeFilter, setTypeFilter] = useState<"all" | "image" | "video">("all");
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

  const visibleScripts = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase(locale);
    const filtered = scripts.filter((script) => {
      if (typeFilter !== "all" && script.media_kind !== typeFilter) return false;
      if (status !== "all" && portfolioWorkStatus(script) !== status) return false;
      if (!normalizedQuery) return true;
      return [script.name, script.title, script.project_title, script.content]
        .join(" ")
        .toLocaleLowerCase(locale)
        .includes(normalizedQuery);
    });
    return [...filtered].sort((left, right) => {
      if (sort === "name") return (left.name || "").localeCompare(right.name || "", locale);
      const difference = new Date(left.updated_at).getTime() - new Date(right.updated_at).getTime();
      return sort === "oldest" ? difference : -difference;
    });
  }, [locale, query, scripts, sort, status, typeFilter]);
  const paginationResetKey = JSON.stringify([query, status, typeFilter, sort, selectedProjectId, locale]);
  const pagination = usePagination(visibleScripts, paginationResetKey, 12);
  const hasActiveFilters = Boolean(query.trim()) || status !== "all" || typeFilter !== "all";

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
    setRenameName(script.name);
    renameDialogRef.current?.showModal();
  };

  const renameScript = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!renamingScript || renameLocked) { showError(renameReason); return; }
    const name = renameName.trim();
    if (!name) {
      showError(t("作品名称不能为空", "Work name is required"));
      return;
    }
    setRenaming(true);
    try {
      const response = await update_script(renamingScript.id, { name });
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

  const createReason = creating ? t("正在创建作品，请稍候", "Work is being created. Please wait.")
    : !projects.some(project => project.id === newProjectId) ? t("请选择所属项目", "Select a project first.")
      : !newKind ? t("请选择作品类型", "Select a work type first.") : t("请输入作品名称", "Enter a work name.");
  const createWork = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (creating || !newKind || !newName.trim() || !projects.some(project => project.id === newProjectId)) {
      showError(createReason);
      return;
    }
    setCreating(true);
    try {
      const response = await create_portfolio_work({ name: newName.trim(), project_id: newProjectId, media_kind: newKind });
      if (!response.success) throw new Error(response.message);
      createDialogRef.current?.close();
      showSuccess(t("作品已创建", "Work created"));
      router.push(`/portfolio/${encodeURIComponent(response.data.id)}`);
    } catch (error) {
      showError(localizeErrorMessage(error instanceof Error ? error.message : "Could not create portfolio work", locale));
    } finally {
      setCreating(false);
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
          <GuardedButton type="button" className="amp-button amp-button-primary"
            disabled={loading || !projects.length || renaming || deleting || creating}
            blockedReason={loading ? t("项目加载中，请稍候", "Projects are loading. Please wait.")
              : !projects.length ? t("请先创建项目", "Create a project first.") : busyReason}
            onClick={() => {
              setNewKind("");
              setNewName("");
              setNewProjectId(projects.some(project => project.id === selectedProjectId) ? selectedProjectId : "");
              createDialogRef.current?.showModal();
            }}>
            {t(CHINESE_ACTIONS.create, ENGLISH_ACTIONS.create)}
          </GuardedButton>
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
              { value: "draft", label: t("草稿", "Draft") },
              { value: "completed", label: t("已完成", "Completed") },
              ...(scripts.some(script => script.status === "generating")
                ? [{ value: "generating" as const, label: t("处理中（历史）", "Processing (legacy)") }] : []),
              ...(scripts.some(script => script.status === "failed")
                ? [{ value: "failed" as const, label: t("保存失败", "Save failed") }] : []),
            ]}
            onChange={setStatus}
            ariaLabel={t("作品状态", "Work status")}
            className="w-36"
          />
          <EnterpriseSelect
            value={typeFilter}
            options={[
              { value: "all", label: t("全部类型", "All types") },
              { value: "image", label: t("图文作品", "Image and copy") },
              { value: "video", label: t("视频作品", "Video work") },
            ]}
            onChange={setTypeFilter}
            ariaLabel={t("类型", "Type")}
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
            <strong>{hasActiveFilters ? t("没有匹配的作品", "No matching work") : t("暂无作品", "No work yet")}</strong>
            <p>{hasActiveFilters
              ? t("请调整搜索关键词或筛选条件。", "Adjust your search or filters.")
              : t("点击“创建”添加作品，或从智能创作保存成品。", "Select Create to add a work, or save one from Content Studio.")}</p>
          </div>
        ) : (
          <>
          <div className="amp-insight-grid">
            {pagination.pageItems.map((script) => {
              const projectTitle = script.project_title
                || projects.find((project) => project.id === script.project_id)?.title
                || t("未关联项目", "No project");
              const workStatus = portfolioWorkStatus(script);
              const statusClass = workStatus === "generating" ? "analyzing"
                : workStatus === "draft" ? "drafting" : workStatus;
              const statusLabel = workStatus === "draft" ? t("草稿", "Draft")
                : workStatus === "generating" ? t("处理中（历史）", "Processing (legacy)")
                  : workStatus === "failed" ? t("保存失败", "Save failed") : t("已完成", "Completed");
              return (
                <article key={script.id} className="amp-portfolio-card">
                  <Link href={`/portfolio/${encodeURIComponent(script.id)}`} className="amp-portfolio-card-link">
                    <span className="amp-portfolio-card-preview" aria-hidden="true">
                      <span className="amp-case-type-overlay">{script.media_kind === "video" ? t("视频", "Video")
                        : script.media_kind === "image" ? t("图文", "Image post") : t("文字档案", "Text archive")}</span>
                      {script.media?.[0]?.media_type === "image"
                        ? <Image src={script.media[0].file_url} alt="" width={480} height={320} unoptimized />
                        : script.media?.[0]?.media_type === "video"
                          ? <video src={script.media[0].file_url} muted playsInline preload="metadata" />
                          : script.media_kind
                            ? <PortfolioEmptyPreview kind={script.media_kind} />
                            : <InlineIcon name="file" />}
                    </span>
                    <span className="amp-portfolio-card-footer">
                      <strong title={script.name}>{script.name || t("未命名作品", "Untitled work")}</strong>
                      <span className="amp-insight-card-meta">
                        <span>{projectTitle}</span>
                        <span className={`amp-insight-status amp-insight-status-${statusClass}`}>{statusLabel}</span>
                        <span className="amp-asset-creator">{script.creator_name || t("未知创建者", "Unknown creator")}</span>
                      </span>
                    </span>
                  </Link>
                  <div ref={menuScriptId === script.id ? menuRef : undefined} className="amp-insight-card-menu">
                    <button type="button" className="amp-insight-card-more"
                      aria-label={t("{name} 作品操作", "Actions for {name}", { name: script.name || t("未命名作品", "Untitled work") })}
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

      <dialog ref={createDialogRef} aria-labelledby="create-work-title"
        className="amp-workspace-dialog m-auto w-[calc(100%_-_32px)] max-w-md bg-white p-6 text-slate-950 backdrop:bg-slate-950/40"
        onCancel={event => { if (creating) { event.preventDefault(); showError(createReason); } }}>
        <form onSubmit={event => void createWork(event)}>
          <h2 id="create-work-title" className="text-xl font-semibold">{t("新建作品", "New work")}</h2>
          <p className="mt-2 text-sm text-slate-500">{t("选择所属项目、作品类型并填写作品名称。", "Select a project, work type and name.")}</p>
          <label className="mt-5 block text-sm font-medium text-slate-700">
            {t("所属项目", "Project")}
            <EnterpriseSelect value={newProjectId}
              options={projects.map(project => ({ value: project.id, label: project.title }))}
              onChange={setNewProjectId} ariaLabel={t("选择所属项目", "Select project")}
              disabled={creating} disabledReason={createReason}
              placeholder={t("请选择项目", "Select a project")} className="mt-2 w-full" />
          </label>
          <label className="mt-4 block text-sm font-medium text-slate-700">
            {t("作品类型", "Work type")}
            <EnterpriseSelect value={newKind} options={[
              { value: "image", label: t("图文作品", "Image and copy") },
              { value: "video", label: t("视频作品", "Video work") },
            ]} onChange={value => setNewKind(value === "video" ? "video" : "image")}
              ariaLabel={t("作品类型", "Work type")} placeholder={t("请选择作品类型", "Select a work type")}
              disabled={creating} disabledReason={createReason}
              className="mt-2 w-full" />
          </label>
          <label className="mt-4 block text-sm font-medium text-slate-700">
            {t("作品名称", "Work name")}
            <GuardedInput value={newName} maxLength={200} autoFocus disabled={creating} blockedReason={createReason}
              onChange={event => setNewName(event.target.value)} placeholder={t("请输入作品名称", "Enter a work name")}
              className="amp-workspace-control mt-2 w-full font-normal" />
          </label>
          <div className="mt-6 flex justify-end gap-3">
            <GuardedButton type="button" className="amp-button amp-button-secondary amp-button-cancel"
              disabled={creating} blockedReason={createReason}
              onClick={() => createDialogRef.current?.close()}>{t(CHINESE_ACTIONS.cancel, ENGLISH_ACTIONS.cancel)}</GuardedButton>
            <GuardedButton type="submit" className="amp-button amp-button-primary"
              disabled={creating || !newKind || !newName.trim() || !projects.some(project => project.id === newProjectId)}
              blockedReason={createReason}>
              {creating ? t(CHINESE_PROGRESS.creating, ENGLISH_PROGRESS.creating) : t(CHINESE_ACTIONS.create, ENGLISH_ACTIONS.create)}
            </GuardedButton>
          </div>
        </form>
      </dialog>

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
        message={t("删除后将无法恢复，确认删除“{name}”吗？", "This cannot be undone. Delete “{name}”?", { name: pendingDelete?.name || "" })}
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
