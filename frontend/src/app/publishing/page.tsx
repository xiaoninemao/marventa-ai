"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
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
import PublishingProjectSidebar from "@/components/publishing/PublishingProjectSidebar";
import {
  create_publication_plan,
  delete_publication_plan,
  fetch_content_projects,
  fetch_publication_plans,
  update_publication_plan,
} from "@/services/api_client";
import type {
  ContentProject,
  PublicationPlan,
} from "@/types/publishing";
import { publicationHasScheduledRelease, publicationReadOnly } from "@/utils/publication_lifecycle";
import { startPolling } from "@/utils/polling";
import { DEFAULT_PAGE_SIZE_OPTIONS, usePagination } from "@/utils/pagination";

type StatusFilter = "all" | PublicationPlan["status"];
const CHANNELS = {
  xiaohongshu: {
    zh: "小红书",
    en: "Xiaohongshu",
  },
  douyin: {
    zh: "抖音",
    en: "Douyin",
  },
} as const;
function PublishingOverview() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, loading: authLoading } = useAuth();
  const { t, locale } = useI18n();
  const { showError, showSuccess } = useToast();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const renameDialogRef = useRef<HTMLDialogElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [projects, setProjects] = useState<ContentProject[]>([]);
  const [plans, setPlans] = useState<PublicationPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<StatusFilter>("all");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<"newest" | "oldest">("newest");
  const [menuPlanId, setMenuPlanId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<PublicationPlan | null>(null);
  const [renamingPlan, setRenamingPlan] = useState<PublicationPlan | null>(null);
  const [renameName, setRenameName] = useState("");
  const selectedProjectId = searchParams.get("project") || "";
  const [formProjectId, setFormProjectId] = useState(selectedProjectId);
  const [planName, setPlanName] = useState("");
  const hasFormProject = projects.some((project) => project.id === formProjectId);
  const busyReason = t("发布计划操作正在处理中，请稍候。", "A publication-plan operation is in progress. Please wait.");
  const missingProjectReason = !projects.length
    ? t("请先创建项目。", "Create a project first.")
    : t("请选择有效的所属项目。", "Select an available project.");
  const projectReason = saving ? busyReason : loading ? t("项目正在加载，请稍候。", "Projects are loading. Please wait.")
    : !projects.length ? t("请先创建项目，再创建发布计划。", "Create a project before creating a publication plan.")
      : t("计划所属项目已固定为当前项目。", "The plan's project is fixed to the current project.");
  const createReason = saving ? busyReason : loading ? projectReason : !hasFormProject
    ? missingProjectReason
    : t("请输入发布计划名称。", "Enter a publication plan name.");

  useEffect(() => {
    if (!authLoading && !user) router.replace("/");
  }, [authLoading, router, user]);

  const loadPage = useCallback(async () => {
    const [projectResponse, planResponse] = await Promise.all([
      fetch_content_projects(),
      fetch_publication_plans(selectedProjectId),
    ]);
    setProjects(projectResponse.data || []);
    setPlans(planResponse.data || []);
  }, [selectedProjectId]);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    setLoading(true);
    loadPage()
      .catch((error) => {
        if (!cancelled) {
          showError(localizeErrorMessage(
            error instanceof Error ? error.message : "Could not load publication plans",
            locale,
          ));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [loadPage, locale, showError, user]);

  useEffect(() => {
    if (!user || authLoading || loading) return;
    return startPolling({
      load: () => fetch_publication_plans(selectedProjectId),
      onResult: ({ data }) => { setPlans(data || []); return true; },
      onError: (reason) => showError(localizeErrorMessage(
        reason instanceof Error ? reason.message : "Could not load publication plans", locale,
      )),
    });
  }, [user, authLoading, loading, selectedProjectId, locale, showError]);

  useEffect(() => {
    if (!menuPlanId) return;
    const close = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuPlanId(null);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [menuPlanId]);

  const openCreateDialog = () => {
    if (saving) { showError(busyReason); return; }
    const projectId = projects.find((project) => project.id === selectedProjectId)?.id
      || projects[0]?.id || "";
    setFormProjectId(projectId);
    setPlanName("");
    dialogRef.current?.showModal();
  };

  const createPlan = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving || loading) { showError(saving ? busyReason : projectReason); return; }
    if (!hasFormProject) {
      showError(missingProjectReason);
      return;
    }
    if (!planName.trim()) {
      showError(t("发布计划名称不能为空", "Publication plan name is required"));
      return;
    }
    setSaving(true);
    try {
      const response = await create_publication_plan({
        project_id: formProjectId,
        name: planName.trim(),
      });
      if (!selectedProjectId || selectedProjectId === response.data.project_id) {
        setPlans((current) => [response.data, ...current]);
      }
      dialogRef.current?.close();
      showSuccess(t("发布计划已创建", "Publication plan created"));
    } catch (error) {
      showError(localizeErrorMessage(
        error instanceof Error ? error.message : "Could not create publication plan",
        locale,
      ));
    } finally {
      setSaving(false);
    }
  };

  const cancelPlan = async (plan: PublicationPlan) => {
    const current = plans.find((item) => item.id === plan.id);
    if (!current || saving || !canManagePlan(current)
      || !publicationHasScheduledRelease(current.status, current.scheduled_for)) {
      showError(!current || saving || !canManagePlan(current) ? manageReason(current)
        : t("此计划当前没有可取消的定时发布。", "This plan has no scheduled publication to cancel.")); return;
    }
    setMenuPlanId(null);
    setSaving(true);
    try {
      const response = await update_publication_plan(plan.id, { status: "cancelled" });
      setPlans((current) => current.map((item) => (
        item.id === plan.id ? response.data : item
      )));
      showSuccess(t("定时发布已取消", "Scheduled publication cancelled"));
    } catch (error) {
      showError(localizeErrorMessage(
        error instanceof Error ? error.message : "Could not update publication plan",
        locale,
      ));
    } finally {
      setSaving(false);
    }
  };

  const deletePlan = async () => {
    const current = plans.find((item) => item.id === pendingDelete?.id);
    if (!pendingDelete || !current || saving || !canRename(current)) { showError(manageReason(current)); return; }
    setSaving(true);
    try {
      await delete_publication_plan(pendingDelete.id);
      setPlans((current) => current.filter((item) => item.id !== pendingDelete.id));
      setPendingDelete(null);
      showSuccess(t("发布计划已删除", "Publication plan deleted"));
    } catch (error) {
      showError(localizeErrorMessage(
        error instanceof Error ? error.message : "Could not delete publication plan",
        locale,
      ));
    } finally {
      setSaving(false);
    }
  };

  const canManagePlan = (plan: PublicationPlan) => {
    const project = projects.find((item) => item.id === plan.project_id);
    return Boolean(user) && (plan.created_by_user_id === user?.id
      || project?.role === "owner" || project?.role === "admin");
  };
  const canRename = (plan: PublicationPlan) => canManagePlan(plan) && !publicationReadOnly(plan.status);
  const manageReason = (plan?: PublicationPlan) => saving ? busyReason : !plan
    ? t("此发布计划已不可用，请刷新列表。", "This publication plan is unavailable. Refresh the list.")
    : plan.status === "published" ? t("已发布的计划不能修改或删除。", "Published plans cannot be changed or deleted.")
      : plan.status === "publishing" ? t("正在发布，不能修改或删除计划。", "Publishing is in progress; the plan cannot be changed or deleted.")
        : plan.status === "scheduled" ? t("计划已锁定，请先取消定时发布再修改。", "Scheduled plans are locked. Cancel the scheduled publication before editing.")
        : t("仅计划创建者和项目管理员可以管理此计划。", "Only the plan creator and project managers can manage this plan.");

  const openRenameDialog = (plan: PublicationPlan) => {
    if (saving || !canRename(plan)) { showError(manageReason(plan)); return; }
    setMenuPlanId(null);
    setRenamingPlan(plan);
    setRenameName(plan.name);
    renameDialogRef.current?.showModal();
  };

  const renamePlan = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const current = plans.find((item) => item.id === renamingPlan?.id);
    if (!renamingPlan || !current || saving || !canRename(current)) { showError(manageReason(current)); return; }
    const name = renameName.trim();
    if (!name) {
      showError(t("发布计划名称不能为空", "Publication plan name is required"));
      return;
    }
    setSaving(true);
    try {
      const response = await update_publication_plan(renamingPlan.id, { name });
      setPlans((current) => current.map((item) => item.id === response.data.id ? response.data : item));
      renameDialogRef.current?.close();
      setRenamingPlan(null);
      showSuccess(t("发布计划名称已更新", "Publication plan name updated"));
    } catch (reason) {
      showError(localizeErrorMessage(
        reason instanceof Error ? reason.message : "Could not update publication plan", locale,
      ));
    } finally {
      setSaving(false);
    }
  };

  const visiblePlans = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    const filtered = plans.filter((plan) => (
      (status === "all" || plan.status === status)
      && plan.name.toLocaleLowerCase().includes(query)
    ));
    return [...filtered].sort((left, right) => {
      const difference = Date.parse(left.created_at) - Date.parse(right.created_at);
      return sort === "oldest" ? difference : -difference;
    });
  }, [plans, search, sort, status]);
  const paginationResetKey = JSON.stringify([search, status, sort, selectedProjectId, locale]);
  const pagination = usePagination(visiblePlans, paginationResetKey, 12);

  useEffect(() => {
    setMenuPlanId(null);
  }, [pagination.page, pagination.pageSize, paginationResetKey]);

  const formatTime = (value: string) => {
    if (!value) return t("立即准备", "Prepare now");
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime())
      ? value
      : parsed.toLocaleString(locale === "en" ? "en-US" : "zh-CN", {
        dateStyle: "medium",
        timeStyle: "short",
      });
  };

  const statusLabel = (planStatus: PublicationPlan["status"]) => ({
    draft: t("草稿", "Draft"),
    scheduled: t("已计划", "Scheduled"),
    publishing: t("发布中", "Publishing"),
    cancelled: t("已取消", "Cancelled"),
    published: t("已发布", "Published"),
    failed: t("失败", "Failed"),
  })[planStatus];
  const renameEditable = Boolean(renamingPlan && plans.some((item) => item.id === renamingPlan.id && canRename(item)));
  const deleteEditable = Boolean(pendingDelete && plans.some((item) => item.id === pendingDelete.id && canRename(item)));

  if (authLoading || !user) {
    return <div className="amp-page-state" role="status">{t(CHINESE_PROGRESS.loading, ENGLISH_PROGRESS.loading)}</div>;
  }

  return (
    <div className="amp-projects-layout">
      <PublishingProjectSidebar projects={projects} selectedProjectId={selectedProjectId} />
      <main className="amp-projects-main">
        <div className="amp-projects-header">
          <div>
            <h1 className="amp-module-title">{t("发布管理", "Publishing")}</h1>
            <p>{selectedProjectId
              ? t("管理当前项目的渠道发布计划。", "Manage channel publication plans for this project.")
              : t("汇总当前组织所有可访问项目的发布计划。", "Publication plans across accessible projects.")}</p>
          </div>
          <GuardedButton blockedReason={busyReason} type="button" className="amp-button amp-button-primary"
            disabled={saving}
            onClick={() => void openCreateDialog()}>
            {t(CHINESE_ACTIONS.create, ENGLISH_ACTIONS.create)}
          </GuardedButton>
        </div>

        <div className="amp-insight-toolbar amp-publishing-toolbar">
          <div className="amp-projects-search amp-project-asset-search mr-auto">
            <RedesignInput
              leftIcon={<InlineIcon name="search" className="h-4 w-4" />}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t("搜索发布计划", "Search publication plans")}
              aria-label={t("搜索发布计划", "Search publication plans")}
            />
          </div>
          <EnterpriseSelect value={status}
            options={[
              { value: "all", label: t("全部状态", "All statuses") },
              { value: "draft", label: t("草稿", "Draft") },
              { value: "scheduled", label: t("已计划", "Scheduled") },
              { value: "publishing", label: t("发布中", "Publishing") },
              { value: "cancelled", label: t("已取消", "Cancelled") },
              { value: "published", label: t("已发布", "Published") },
              { value: "failed", label: t("失败", "Failed") },
            ]}
            onChange={setStatus}
            ariaLabel={t("发布状态", "Publication status")}
            className="w-36" />
          <EnterpriseSelect value={sort}
            options={[
              { value: "newest", label: t("最近创建", "Newest") },
              { value: "oldest", label: t("最早创建", "Oldest") },
            ]}
            onChange={setSort}
            ariaLabel={t("发布计划排序", "Publication plan sorting")}
            className="w-36" />
        </div>

        {loading ? (
          <div className="amp-projects-state" role="status">{t("正在加载发布计划...", "Loading publication plans...")}</div>
        ) : visiblePlans.length === 0 ? (
          <div className="amp-projects-state">
            <span className="amp-projects-empty-icon"><InlineIcon name="send" /></span>
            <strong>{search.trim() || status !== "all"
              ? t("未找到匹配的发布计划", "No matching publication plans")
              : t("暂无发布计划", "No publication plans")}</strong>
            <p>{search.trim() || status !== "all"
              ? t("请调整搜索关键词或状态筛选。", "Try another search term or status.")
              : t(
              "选择项目并填写名称，即可创建发布草稿。",
              "Select a project and enter a name to create a publication draft.",
            )}</p>
          </div>
        ) : (
          <>
          <div className="amp-publication-brief-grid">
            {pagination.pageItems.map((plan) => {
              const channel = plan.platform ? CHANNELS[plan.platform] : null;
              return (
                <article key={plan.id} className={`amp-insight-card amp-publication-card${publicationReadOnly(plan.status) ? " is-publication-readonly" : ""}`}>
                  <Link href={`/publishing/${encodeURIComponent(plan.id)}`}
                    className="amp-insight-card-link amp-publication-card-link"
                    aria-label={t("设置发布计划：{name}", "Configure publication plan: {name}", { name: plan.name })}>
                  <div className="amp-insight-card-body">
                    <span className="amp-insight-card-heading">
                      <strong title={plan.name}>{plan.name}</strong>
                    </span>
                    <dl className="amp-publication-brief">
                      <div>
                        <dt>{t("发布时间", "Publish time")}</dt>
                        <dd className={!plan.scheduled_for ? "is-pending" : ""}>
                          {plan.scheduled_for ? formatTime(plan.scheduled_for) : t("待安排", "Not scheduled")}
                        </dd>
                      </div>
                      <div>
                        <dt>{t("发布内容", "Content")}</dt>
                        <dd className={!plan.content_count ? "is-pending" : ""}>
                          {plan.content_count ? [
                            plan.image_count ? t("图片 {count}", "{count} images", { count: plan.image_count }) : "",
                            plan.video_count ? t("视频 {count}", "{count} videos", { count: plan.video_count }) : "",
                            plan.document_count ? t("文案 {count}", "{count} copy", { count: plan.document_count }) : "",
                          ].filter(Boolean).join(" · ") : t("待添加", "Not added")}
                        </dd>
                      </div>
                      <div>
                        <dt>{t("发布渠道", "Channel")}</dt>
                        <dd className={!channel ? "is-pending" : ""}>
                          {channel ? t(channel.zh, channel.en) : t("待选择", "Not selected")}
                        </dd>
                      </div>
                      <div>
                        <dt>{t("发布账号", "Account")}</dt>
                        <dd className={`amp-publication-brief-account${!plan.channel_account_id ? " is-pending" : ""}`}
                          title={plan.channel_account_id ? plan.account_name : undefined}>
                          {plan.channel_account_id
                            ? plan.account_name
                            : t("待选择", "Not selected")}
                        </dd>
                      </div>
                    </dl>
                    {plan.note && <span className="amp-insight-card-summary" title={plan.note}>{plan.note}</span>}
                    {plan.last_error && <span className="amp-insight-card-summary break-words"
                      title={localizeErrorMessage(plan.last_error, locale)}>{localizeErrorMessage(plan.last_error, locale)}</span>}
                    {plan.outcome_unknown && <strong className="amp-insight-card-summary">
                      {t("平台可能已发布，再次安排前请先核实。", "The platform may have published this post. Verify before scheduling again.")}
                    </strong>}
                    <span className="amp-insight-card-meta">
                      <span title={plan.project_title}>{plan.project_title}</span>
                      <span className={`amp-insight-status amp-insight-status-${{
                        draft: "drafting", scheduled: "analyzing", publishing: "analyzing", published: "completed",
                        cancelled: "drafting", failed: "failed",
                      }[plan.status]}`}>{statusLabel(plan.status)}</span>
                      <span className="amp-asset-creator" title={plan.creator_name}>{plan.creator_name || t("未知创建者", "Unknown creator")}</span>
                    </span>
                  </div>
                  </Link>
                  {canRename(plan) && <div ref={menuPlanId === plan.id ? menuRef : undefined}
                    className="amp-insight-card-menu">
                    <button type="button" className="amp-insight-card-more"
                      aria-haspopup="menu" aria-expanded={menuPlanId === plan.id}
                      aria-label={t("{name} 发布操作", "Publishing actions for {name}", {
                        name: plan.name,
                      })}
                      onClick={() => setMenuPlanId((current) =>
                        current === plan.id ? null : plan.id)}>
                      <InlineIcon name="more" className="h-5 w-5" strokeWidth={3} />
                    </button>
                    {menuPlanId === plan.id && (
                      <div role="menu" className="amp-insight-card-popover">
                        <GuardedButton blockedReason={manageReason(plan)} type="button" role="menuitem" disabled={saving || !canRename(plan)}
                          onClick={() => openRenameDialog(plan)}>
                          <InlineIcon name="edit" />{t(CHINESE_ACTIONS.rename, ENGLISH_ACTIONS.rename)}
                        </GuardedButton>
                        {publicationHasScheduledRelease(plan.status, plan.scheduled_for) && (
                          <GuardedButton blockedReason={busyReason} type="button" role="menuitem" disabled={saving || !canManagePlan(plan)}
                            onClick={() => void cancelPlan(plan)}>
                            <InlineIcon name="close" />
                            {t("取消发布", `${ENGLISH_ACTIONS.cancel} publication`)}
                          </GuardedButton>
                        )}
                        <GuardedButton blockedReason={manageReason(plan)} type="button" role="menuitem"
                          className="amp-insight-card-delete" disabled={saving || !canRename(plan)}
                          onClick={() => {
                            setMenuPlanId(null);
                            setPendingDelete(plan);
                          }}>
                          <InlineIcon name="trash" />
                          {t(CHINESE_ACTIONS.delete, ENGLISH_ACTIONS.delete)}
                        </GuardedButton>
                      </div>
                    )}
                  </div>}
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

      <dialog ref={dialogRef} aria-labelledby="create-publication-title"
        className="amp-workspace-dialog m-auto w-[calc(100%_-_32px)] max-w-lg bg-white p-6 text-slate-950 backdrop:bg-slate-950/40"
        onCancel={(event) => { if (saving) { event.preventDefault(); showError(busyReason); } }}>
        <form onSubmit={(event) => void createPlan(event)}
          className="amp-publication-form">
          <h2 id="create-publication-title" className="text-lg font-semibold">
            {t("创建计划", "Create plan")}
          </h2>
          <label>
            <span>{t("项目", "Project")}</span>
            <EnterpriseSelect value={formProjectId}
              options={projects.map((project) => ({
                value: project.id,
                label: project.title,
              }))}
              onChange={setFormProjectId}
              ariaLabel={t("选择项目", "Select project")}
              placeholder={loading
                ? t("正在加载项目...", "Loading projects...")
                : projects.length ? t("请选择项目", "Select a project") : t("暂无可用项目", "No projects available")}
              disabled={saving || loading || projects.length === 0
                || projects.some((project) => project.id === selectedProjectId)}
              disabledReason={projectReason}
              className="mt-2 w-full" />
          </label>
          {!loading && projects.length === 0 && (
            <p className="text-sm text-slate-500">
              {t("请先创建项目，再安排发布。", "Create a project before preparing a publication.")}
              {" "}<Link href="/projects" className="text-blue-600 hover:underline"
                onClick={() => dialogRef.current?.close()}>{t(CHINESE_ACTIONS.open, ENGLISH_ACTIONS.open)}</Link>
            </p>
          )}
          <label>
            <span>{t("名称", "Name")}</span>
            <GuardedInput blockedReason={busyReason} value={planName} maxLength={120} required
              placeholder={t("请输入发布计划名称", "Enter a publication plan name")}
              onInvalid={(event) => { event.preventDefault(); showError(t("请输入发布计划名称。", "Enter a publication plan name.")); }}
              onChange={(event) => setPlanName(event.target.value)}
              disabled={saving} className="amp-workspace-control mt-2 w-full" />
          </label>
          <div className="amp-project-channel-account-actions">
            <GuardedButton blockedReason={busyReason} type="button" className="amp-button amp-button-secondary amp-button-cancel"
              disabled={saving} onClick={() => dialogRef.current?.close()}>
              {t(CHINESE_ACTIONS.cancel, ENGLISH_ACTIONS.cancel)}
            </GuardedButton>
            <GuardedButton blockedReason={createReason} type="submit" className="amp-button amp-button-primary"
              disabled={saving || loading || !hasFormProject || !planName.trim()}>
              {saving ? t(CHINESE_PROGRESS.creating, ENGLISH_PROGRESS.creating) : t(CHINESE_ACTIONS.create, ENGLISH_ACTIONS.create)}
            </GuardedButton>
          </div>
        </form>
      </dialog>

      <dialog ref={renameDialogRef} aria-labelledby="rename-publication-title"
        className="amp-workspace-dialog m-auto w-[calc(100%_-_32px)] max-w-md bg-white p-6 text-slate-950 backdrop:bg-slate-950/40"
        onCancel={(event) => { if (saving) { event.preventDefault(); showError(busyReason); } }}
        onClose={() => { if (!saving) setRenamingPlan(null); }}>
        <h2 id="rename-publication-title" className="text-lg font-semibold">{t("重命名发布计划", "Rename publication plan")}</h2>
        <form className="mt-5" onSubmit={(event) => void renamePlan(event)}>
          <label htmlFor="rename-publication-name" className="mb-2 block text-sm font-medium">
            {t("计划名称", "Plan name")}
          </label>
          <GuardedInput blockedReason={manageReason(plans.find((item) => item.id === renamingPlan?.id))} id="rename-publication-name" autoFocus required maxLength={120}
            className="amp-workspace-control w-full" value={renameName} disabled={saving || !renameEditable}
            onInvalid={(event) => { event.preventDefault(); showError(t("请输入发布计划名称。", "Enter a publication plan name.")); }}
            onChange={(event) => setRenameName(event.target.value)} />
          <div className="mt-6 flex justify-end gap-3">
            <GuardedButton blockedReason={busyReason} type="button" className="amp-button amp-button-secondary amp-button-cancel" disabled={saving}
              onClick={() => renameDialogRef.current?.close()}>{t(CHINESE_ACTIONS.cancel, ENGLISH_ACTIONS.cancel)}</GuardedButton>
            <GuardedButton blockedReason={saving || !renameEditable ? manageReason(plans.find((item) => item.id === renamingPlan?.id)) : t("请输入发布计划名称。", "Enter a publication plan name.")} type="submit" className="amp-button amp-button-primary" disabled={saving || !renameEditable || !renameName.trim()}>
              {saving ? t(CHINESE_PROGRESS.saving, ENGLISH_PROGRESS.saving) : t(CHINESE_ACTIONS.save, ENGLISH_ACTIONS.save)}
            </GuardedButton>
          </div>
        </form>
      </dialog>

      <DeleteConfirmDialog open={deleteEditable}
        title={t("删除发布计划", "Delete publication plan")}
        message={t(
          "确认删除“{title}”的发布计划吗？",
          "Delete the publication plan for “{title}”?",
          { title: pendingDelete?.name || "" },
        )}
        cancelLabel={t(CHINESE_ACTIONS.cancel, ENGLISH_ACTIONS.cancel)}
        confirmLabel={t(CHINESE_ACTIONS.delete, ENGLISH_ACTIONS.delete)}
        busyLabel={t(CHINESE_PROGRESS.deleting, ENGLISH_PROGRESS.deleting)}
        busy={saving}
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => void deletePlan()} />
    </div>
  );
}

export default function PublishingPage() {
  return (
    <Suspense fallback={<div className="amp-page-state" role="status">Loading...</div>}>
      <PublishingOverview />
    </Suspense>
  );
}
