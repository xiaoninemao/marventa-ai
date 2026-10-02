"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/contexts/auth_context";
import { useI18n } from "@/contexts/i18n_context";
import { useToast } from "@/contexts/toast_context";
import { localizeErrorMessage } from "@/i18n/errors";
import InlineIcon from "@/components/redesign/InlineIcon";
import EnterpriseSelect from "@/components/redesign/EnterpriseSelect";
import RedesignInput from "@/components/redesign/RedesignInput";
import DeleteConfirmDialog from "@/components/redesign/DeleteConfirmDialog";
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
import { publicationHasScheduledRelease, publicationPublishedNotice, publicationReadOnly } from "@/utils/publication_lifecycle";
import { startPolling } from "@/utils/polling";

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
    const projectId = projects.find((project) => project.id === selectedProjectId)?.id
      || projects[0]?.id || "";
    setFormProjectId(projectId);
    setPlanName("");
    dialogRef.current?.showModal();
  };

  const createPlan = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving) return;
    if (!hasFormProject) {
      showError(t("请选择所属项目", "Select a project"));
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
    if (!current || saving || !canRename(current)
      || !publicationHasScheduledRelease(current.status, current.scheduled_for)) return;
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
    if (!pendingDelete || !current || saving || !canRename(current)) return;
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

  const canRename = (plan: PublicationPlan) => {
    const project = projects.find((item) => item.id === plan.project_id);
    return Boolean(user) && !publicationReadOnly(plan.status) && (plan.created_by_user_id === user?.id
      || project?.role === "owner" || project?.role === "admin");
  };

  const openRenameDialog = (plan: PublicationPlan) => {
    if (saving || !canRename(plan)) return;
    setMenuPlanId(null);
    setRenamingPlan(plan);
    setRenameName(plan.name);
    renameDialogRef.current?.showModal();
  };

  const renamePlan = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const current = plans.find((item) => item.id === renamingPlan?.id);
    if (!renamingPlan || !current || saving || !canRename(current)) return;
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
    return <div className="amp-page-state" role="status">{t("加载中...", "Loading...")}</div>;
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
          <button type="button" className="amp-button amp-button-primary"
            disabled={saving}
            onClick={() => void openCreateDialog()}>
            {t("创建计划", "Create plan")}
          </button>
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
              "Choose a project and enter a name to create a publication draft.",
            )}</p>
          </div>
        ) : (
          <div className="amp-publication-brief-grid">
            {visiblePlans.map((plan) => {
              const channel = plan.platform ? CHANNELS[plan.platform] : null;
              const publishedNotice = publicationPublishedNotice(plan.status);
              return (
                <article key={plan.id} className="amp-insight-card amp-publication-card">
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
                    {publishedNotice && <span className="amp-insight-card-summary" title={t(publishedNotice.zh, publishedNotice.en)}>
                      {t(publishedNotice.zh, publishedNotice.en)}
                    </span>}
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
                        <button type="button" role="menuitem" disabled={saving || !canRename(plan)}
                          onClick={() => openRenameDialog(plan)}>
                          <InlineIcon name="edit" />{t("重命名", "Rename")}
                        </button>
                        {publicationHasScheduledRelease(plan.status, plan.scheduled_for) && (
                          <button type="button" role="menuitem" disabled={saving}
                            onClick={() => void cancelPlan(plan)}>
                            <InlineIcon name="close" />
                            {t("取消发布", "Cancel publication")}
                          </button>
                        )}
                        <button type="button" role="menuitem"
                          className="amp-insight-card-delete" disabled={saving}
                          onClick={() => {
                            setMenuPlanId(null);
                            setPendingDelete(plan);
                          }}>
                          <InlineIcon name="trash" />
                          {t("删除", "Delete")}
                        </button>
                      </div>
                    )}
                  </div>}
                </article>
              );
            })}
          </div>
        )}
      </main>

      <dialog ref={dialogRef} aria-labelledby="create-publication-title"
        className="amp-workspace-dialog m-auto w-[calc(100%_-_32px)] max-w-lg bg-white p-6 text-slate-950 backdrop:bg-slate-950/40"
        onCancel={(event) => { if (saving) event.preventDefault(); }}>
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
              ariaLabel={t("选择项目", "Choose project")}
              placeholder={loading
                ? t("正在加载项目...", "Loading projects...")
                : projects.length ? t("请选择项目", "Choose a project") : t("暂无可用项目", "No projects available")}
              disabled={saving || loading || projects.length === 0
                || projects.some((project) => project.id === selectedProjectId)}
              className="mt-2 w-full" />
          </label>
          {!loading && projects.length === 0 && (
            <p className="text-sm text-slate-500">
              {t("请先创建项目，再安排发布。", "Create a project before preparing a publication.")}
              {" "}<Link href="/projects" className="text-blue-600 hover:underline"
                onClick={() => dialogRef.current?.close()}>{t("前往项目", "Go to projects")}</Link>
            </p>
          )}
          <label>
            <span>{t("名称", "Name")}</span>
            <input value={planName} maxLength={120} required
              placeholder={t("请输入发布计划名称", "Enter a publication plan name")}
              onChange={(event) => setPlanName(event.target.value)}
              disabled={saving} className="amp-workspace-control mt-2 w-full" />
          </label>
          <div className="amp-project-channel-account-actions">
            <button type="button" className="amp-button amp-button-secondary amp-button-cancel"
              disabled={saving} onClick={() => dialogRef.current?.close()}>
              {t("取消", "Cancel")}
            </button>
            <button type="submit" className="amp-button amp-button-primary"
              disabled={saving || loading || !hasFormProject || !planName.trim()}>
              {saving ? t("创建中...", "Creating...") : t("创建计划", "Create plan")}
            </button>
          </div>
        </form>
      </dialog>

      <dialog ref={renameDialogRef} aria-labelledby="rename-publication-title"
        className="amp-workspace-dialog m-auto w-[calc(100%_-_32px)] max-w-md bg-white p-6 text-slate-950 backdrop:bg-slate-950/40"
        onCancel={(event) => { if (saving) event.preventDefault(); }}
        onClose={() => { if (!saving) setRenamingPlan(null); }}>
        <h2 id="rename-publication-title" className="text-lg font-semibold">{t("重命名发布计划", "Rename publication plan")}</h2>
        <form className="mt-5" onSubmit={(event) => void renamePlan(event)}>
          <label htmlFor="rename-publication-name" className="mb-2 block text-sm font-medium">
            {t("计划名称", "Plan name")}
          </label>
          <input id="rename-publication-name" autoFocus required maxLength={120}
            className="amp-workspace-control w-full" value={renameName} disabled={saving || !renameEditable}
            onChange={(event) => setRenameName(event.target.value)} />
          <div className="mt-6 flex justify-end gap-3">
            <button type="button" className="amp-button amp-button-secondary amp-button-cancel" disabled={saving}
              onClick={() => renameDialogRef.current?.close()}>{t("取消", "Cancel")}</button>
            <button type="submit" className="amp-button amp-button-primary" disabled={saving || !renameEditable || !renameName.trim()}>
              {saving ? t("保存中...", "Saving...") : t("保存", "Save")}
            </button>
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
        cancelLabel={t("取消", "Cancel")}
        confirmLabel={t("删除", "Delete")}
        busyLabel={t("删除中...", "Deleting...")}
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
