"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "@/contexts/auth_context";
import { useI18n } from "@/contexts/i18n_context";
import { ENGLISH_ACTIONS, ENGLISH_PROGRESS, CHINESE_PROGRESS, CHINESE_ACTIONS } from "@/i18n/interaction_copy";
import { useToast } from "@/contexts/toast_context";
import { localizeErrorMessage } from "@/i18n/errors";
import InlineIcon from "@/components/redesign/InlineIcon";
import { GuardedButton } from "@/components/redesign/GuardedControls";
import EnterpriseSelect, { type EnterpriseSelectOption } from "@/components/redesign/EnterpriseSelect";
import DeleteConfirmDialog from "@/components/redesign/DeleteConfirmDialog";
import PublicationContentPanel from "@/components/publishing/PublicationContentPanel";
import PublicationSchedulePicker from "@/components/publishing/PublicationSchedulePicker";
import PublishingProjectSidebar from "@/components/publishing/PublishingProjectSidebar";
import {
  fetch_content_projects, fetch_publication_plan, fetch_project_channel_accounts,
  update_publication_plan,
} from "@/services/api_client";
import type { ContentProject, PublicationPlan, ProjectChannelAccount } from "@/types/publishing";
import {
  publicationLocalTime, publicationSchedule, publicationScheduleInput,
  validatePublicationScheduleSelection,
} from "@/utils/publication_schedule";
import { publicationSettingsIssue } from "@/utils/publication_settings";
import { publicationHasScheduledRelease, publicationNeedsPolling, publicationPublishedNotice, publicationReadOnly } from "@/utils/publication_lifecycle";
import { startPolling } from "@/utils/polling";

type PlanForm = {
  platform: PublicationPlan["platform"];
  channel_account_id: string;
  scheduled_for: string;
};

function formFromPlan(plan: PublicationPlan): PlanForm {
  return {
    platform: plan.platform,
    channel_account_id: plan.channel_account_id,
    scheduled_for: publicationLocalTime(plan.scheduled_for),
  };
}

export default function PublicationSettingsPage() {
  const { planId } = useParams<{ planId: string }>();
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const { t, locale } = useI18n();
  const { showError, showSuccess } = useToast();
  const [plan, setPlan] = useState<PublicationPlan | null>(null);
  const [form, setForm] = useState<PlanForm | null>(null);
  const [projects, setProjects] = useState<ContentProject[]>([]);
  const [accounts, setAccounts] = useState<ProjectChannelAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [contentBusy, setContentBusy] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const settingsDialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    if (!authLoading && !user) router.replace("/");
  }, [authLoading, router, user]);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    setLoading(true);
    setError("");
    const load = async () => {
      const [planResponse, projectResponse] = await Promise.all([
        fetch_publication_plan(planId), fetch_content_projects(),
      ]);
      const current = planResponse.data;
      const accountResponse = await fetch_project_channel_accounts(current.project_id);
      if (cancelled) return;
      const nextForm = formFromPlan(current);
      setPlan(current);
      setForm(nextForm);
      setProjects(projectResponse.data);
      setAccounts(accountResponse.data.filter((account) => account.authorization_status === "active"));
    };
    void load().catch((reason: unknown) => {
      if (!cancelled) setError(localizeErrorMessage(
        reason instanceof Error ? reason.message : "Could not load publication plan", locale,
      ));
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [planId, user, locale, attempt]);

  const project = projects.find((item) => item.id === plan?.project_id);
  const canManage = Boolean(user && plan && (plan.created_by_user_id === user.id
    || project?.role === "owner" || project?.role === "admin"));
  const canEdit = canManage && Boolean(plan && !publicationReadOnly(plan.status));
  const editable = canEdit;
  const settingsEditable = editable;
  const busyReason = cancelling ? t("正在取消发布，请稍候。", "Publication is being cancelled. Please wait.")
    : saving ? t("发布设置正在保存，请稍候。", "Publication settings are being saved. Please wait.")
      : t("媒体或文案正在保存，请稍候。", "Media or copy is being saved. Please wait.");
  const settingsReason = saving || contentBusy || cancelling ? busyReason
    : plan?.status === "published" ? t("已发布的计划仅供查看，不能修改设置。", "Published plans are read-only; settings cannot change.")
      : plan?.status === "publishing" ? t("正在发布，不能修改设置。", "Publishing is in progress; settings cannot change.")
        : plan?.status === "scheduled" ? t("计划已锁定，请先取消定时发布再修改。", "Scheduled plans are locked. Cancel the scheduled publication before editing.")
          : t("仅计划创建者和项目管理员可以修改设置。", "Only the plan creator and project managers can edit settings.");
  const unsupportedReason = t("小红书发布暂未开放，请选择抖音。", "Xiaohongshu publishing is not available; select Douyin.");
  const selectChannelReason = t("请先选择发布渠道。", "Select a publication channel first.");
  const noAccountReason = t("此项目尚未连接抖音账号，请先在项目中连接账号。", "This project has no connected Douyin account. Connect one in the project first.");
  const unavailableAccountReason = t("原发布账号已不可用，请重新选择已连接的账号。", "The previous account is unavailable. Select a connected account.");
  const settingsValidationReason = (currentPlan: PublicationPlan, currentForm: PlanForm): string => {
    const issue = publicationSettingsIssue({
      platform: currentForm.platform,
      accountId: currentForm.channel_account_id,
      accounts,
      scheduledFor: currentForm.scheduled_for,
      mediaMode: currentPlan.media_mode,
      contentCount: currentPlan.content_count,
      videoCount: currentPlan.video_count,
    });
    if (!issue) return "";
    const reasons = {
      "missing-channel": selectChannelReason,
      "unsupported-channel": unsupportedReason,
      "missing-account": t("请选择已连接的发布账号。", "Select a connected publication account."),
      "no-accounts": noAccountReason,
      "unavailable-account": unavailableAccountReason,
      "missing-schedule": t("请选择发布日期和时间。", "Select a publication date and time."),
      "invalid-schedule": t("请选择明天或之后的有效发布日期和时间。", "Select a valid publication date tomorrow or later and a time."),
      "missing-content": t("请先添加发布媒体或文案。", "Add publication media or copy first."),
      "invalid-video": t("视频发布需要且只能有一个视频。", "Video publishing requires exactly one video."),
    };
    return reasons[issue];
  };
  const shouldPoll = Boolean(plan && publicationNeedsPolling(plan.status));
  useEffect(() => {
    if (!user || authLoading || loading || !shouldPoll) return;
    return startPolling({
      load: () => fetch_publication_plan(planId),
      onResult: ({ data }) => {
        setPlan(data);
        return publicationNeedsPolling(data.status);
      },
      onError: (reason) => showError(localizeErrorMessage(
        reason instanceof Error ? reason.message : "Could not load publication plan", locale,
      )),
    });
  }, [user, authLoading, loading, shouldPoll, planId, locale, showError]);

  const statusLabel = (status: PublicationPlan["status"]) => ({
    draft: t("草稿", "Draft"), scheduled: t("已计划", "Scheduled"),
    publishing: t("发布中", "Publishing"),
    cancelled: t("已取消", "Cancelled"), published: t("已发布", "Published"), failed: t("失败", "Failed"),
  })[status];

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!plan || !form || !settingsEditable || saving || contentBusy || cancelling) {
      showError(settingsReason); return;
    }
    const validationReason = settingsValidationReason(plan, form);
    if (validationReason) { showError(validationReason); return; }
    setSaving(true);
    try {
      validatePublicationScheduleSelection(form.scheduled_for);
      const scheduledFor = publicationSchedule(form.scheduled_for, plan.scheduled_for);
      if (!plan.content_count || !form.channel_account_id) {
        throw new Error("Content, account and time are required to schedule");
      }
      if (plan.media_mode === "video" && plan.video_count !== 1) {
        throw new Error("Video mode requires one video to schedule");
      }
      const response = await update_publication_plan(plan.id, {
        channel_account_id: form.channel_account_id,
        scheduled_for: scheduledFor,
      });
      setPlan(response.data);
      setForm(formFromPlan(response.data));
      settingsDialog.current?.close();
      showSuccess(t("发布设置已保存", "Publication settings saved"));
    } catch (reason) {
      showError(localizeErrorMessage(
        reason instanceof Error ? reason.message : "Could not update publication plan", locale,
      ));
    } finally {
      setSaving(false);
    }
  };

  const cancelPlan = async () => {
    if (!plan || !canManage || !publicationHasScheduledRelease(plan.status, plan.scheduled_for)
      || saving || contentBusy || cancelling) {
      showError(saving || contentBusy || cancelling || !canManage ? settingsReason
        : t("此计划当前没有可取消的定时发布。", "This plan has no scheduled publication to cancel.")); return;
    }
    setCancelling(true);
    try {
      const response = await update_publication_plan(plan.id, { status: "cancelled" });
      setPlan(response.data);
      setForm(formFromPlan(response.data));
      setConfirmCancel(false);
      showSuccess(t("定时发布已取消", "Scheduled publication cancelled"));
    } catch (reason) {
      showError(localizeErrorMessage(
        reason instanceof Error ? reason.message : "Could not update publication plan", locale,
      ));
    } finally {
      setCancelling(false);
    }
  };

  if (authLoading || !user || loading) {
    return <div className="amp-page-state" role="status">{t(CHINESE_PROGRESS.loading, ENGLISH_PROGRESS.loading)}</div>;
  }
  if (error || !plan || !form) {
    return <div className="amp-page-state" role="alert">
      <strong>{error || t("发布计划不存在", "Publication plan not found")}</strong>
      <div className="flex gap-3">
        <Link href="/publishing" className="amp-button amp-button-secondary">{t(CHINESE_ACTIONS.back, ENGLISH_ACTIONS.back)}</Link>
        <button type="button" className="amp-button amp-button-secondary"
          onClick={() => setAttempt((value) => value + 1)}>{t(CHINESE_ACTIONS.retry, ENGLISH_ACTIONS.retry)}</button>
      </div>
    </div>;
  }

  const channelOptions: Array<EnterpriseSelectOption<PublicationPlan["platform"]>> = [
    { value: "xiaohongshu", label: t("小红书", "Xiaohongshu"), disabled: true,
      disabledReason: unsupportedReason,
      description: t("发布接口暂未开放", "Publishing API not available yet") },
    { value: "douyin", label: t("抖音", "Douyin") },
  ];
  const [scheduledDate = "", scheduledTime = ""] = form.scheduled_for.split("T");
  const channelAccounts = accounts.filter((account) => account.platform === form.platform);
  const publishedNotice = publicationPublishedNotice(plan.status);
  const accountOptions = [
    ...channelAccounts.map((account) => ({
      value: account.id,
      label: account.account_name,
    })),
    ...(form.channel_account_id && !channelAccounts.some((account) => account.id === form.channel_account_id)
      ? [{ value: form.channel_account_id, label: t("原账号已不可用，请重新选择", "Previous account unavailable; select again"), disabled: true, disabledReason: unavailableAccountReason }] : []),
  ];
  const saveReason = saving || contentBusy || cancelling || !settingsEditable ? settingsReason
    : settingsValidationReason(plan, form);

  return (
    <div className="amp-project-detail-layout">
      <PublishingProjectSidebar projects={projects} selectedProjectId={plan.project_id} />
      <main className={`amp-project-detail-main amp-publication-editor-main${publicationReadOnly(plan.status) ? " is-publication-readonly" : ""}`}>
        <header className="amp-project-detail-header">
          <div className="amp-project-detail-title">
            <Link href={`/publishing?project=${encodeURIComponent(plan.project_id)}`}
              className="amp-project-detail-back" aria-label={t("返回发布管理", "Back to publishing")}>
              <InlineIcon name="arrowLeft" />
            </Link>
            <div>
              <div className="amp-insight-title-row">
                <h1>{plan.name}</h1>
                <span className={`amp-insight-status amp-insight-status-${{
                  draft: "drafting", scheduled: "analyzing", publishing: "analyzing", cancelled: "drafting",
                  published: "completed", failed: "failed",
                }[plan.status]}`}>{statusLabel(plan.status)}</span>
              </div>
              <p>{plan.project_title}</p>
            </div>
          </div>
          <div className="amp-publication-header-actions">
            <GuardedButton blockedReason={busyReason} type="button" className="amp-button amp-button-secondary" disabled={contentBusy || saving || cancelling}
              onClick={() => { setForm(formFromPlan(plan)); settingsDialog.current?.showModal(); }}>
              <InlineIcon name="settings" className="h-4 w-4" />{t("发布设置", "Publication settings")}
            </GuardedButton>
          </div>
        </header>
        {plan.status === "publishing" && <p role="status" className="amp-publication-settings-notice">
          {t("正在发布，发布设置、媒体和文案暂时不可修改。", "Publishing is in progress. Publication settings, media and copy are read-only.")}
        </p>}
        {(plan.status === "failed" || plan.last_error || plan.outcome_unknown) && <div role="alert" className="amp-publication-copy-save-error">
          {plan.last_error && <p className="whitespace-pre-wrap break-words">{localizeErrorMessage(plan.last_error, locale)}</p>}
          {plan.status === "failed" && <p>{t("发布失败。媒体和文案已保留，可修改发布设置并保存新的发布时间重试。",
            "Publication failed. Media and copy are retained. Edit publication settings and save a publish time to retry.")}</p>}
          {plan.outcome_unknown && <p><strong>{t("发布结果未知：平台可能已经发布。再次安排发布前，必须先到平台核实，避免重复发布。",
            "Publication outcome unknown: the platform may already have published this post. You must verify on the platform before scheduling again to avoid duplicates.")}</strong></p>}
        </div>}
        <div className="amp-publication-workspace">
        <PublicationContentPanel key={plan.id} plan={plan} editable={editable} disabled={saving || cancelling}
          onBusyChange={setContentBusy}
          onChanged={async () => {
            const response = await fetch_publication_plan(plan.id);
            const refreshed = response.data;
            setPlan(refreshed);
          }} />
        </div>
        <dialog ref={settingsDialog} aria-labelledby="publication-plan-heading"
          className="amp-material-preview-dialog amp-publication-settings-dialog m-auto w-[calc(100%_-_32px)] max-w-lg bg-white backdrop:bg-slate-950/40"
          onCancel={(event) => { if (saving) { event.preventDefault(); showError(busyReason); } }}>
          <header>
            <h2 id="publication-plan-heading">{t("发布设置", "Publication settings")}</h2>
            {!settingsEditable && <GuardedButton blockedReason={busyReason} type="button" className="amp-material-preview-icon" disabled={saving}
              aria-label={t("关闭发布设置", "Close publication settings")} onClick={() => settingsDialog.current?.close()}>
              <InlineIcon name="close" />
            </GuardedButton>}
          </header>
        <form id="publication-settings-form" className="amp-publication-form amp-publication-settings"
          onSubmit={(event) => void save(event)}>
          {!editable && <p className="amp-publication-settings-notice">{plan.status === "published"
            ? t("已发布的计划仅供查看。", "Published plans are read-only.")
            : plan.status === "publishing" ? t("发布中的计划仅供查看。", "Publishing plans are read-only.")
              : plan.status === "scheduled" ? t("已计划的内容和设置已锁定，取消定时发布后才能修改。", "Scheduled content and settings are locked. Cancel the scheduled publication to edit.")
                : t("仅创建者和项目管理员可以修改计划。", "Only the creator and project managers can edit this plan.")}</p>}
          {publishedNotice && <p role="status" className="amp-publication-settings-notice">
            {t(publishedNotice.zh, publishedNotice.en)}
          </p>}
          <label>
            <span>{t("发布渠道", "Channel")}</span>
            <EnterpriseSelect value={form.platform} options={channelOptions} className="mt-2 w-full"
              placeholder={t("选择渠道", "Select channel")}
              disabled={!settingsEditable || saving || contentBusy || cancelling} disabledReason={settingsReason} ariaLabel={t("选择发布渠道", "Select publication channel")}
              onChange={(value) => {
                if (!settingsEditable || saving || contentBusy || cancelling) { showError(settingsReason); return; }
                if (value === "xiaohongshu") { showError(unsupportedReason); return; }
                setForm({
                ...form,
                platform: value,
                channel_account_id: value === form.platform ? form.channel_account_id : "",
              }); }} />
            {settingsEditable && form.platform === "xiaohongshu" && <small>
              {t("小红书发布暂未开放，请切换到抖音。", "Xiaohongshu publishing is not available; switch to Douyin.")}
            </small>}
          </label>
          <label>
            <div className="amp-publication-schedule-heading">
              <span>{t("发布账号", "Account")}</span>
            </div>
            <EnterpriseSelect value={form.channel_account_id} options={accountOptions} className="mt-2 w-full"
              placeholder={t("待选择", "Not selected")}
              disabled={!settingsEditable || saving || contentBusy || cancelling || form.platform !== "douyin" || !channelAccounts.length}
              disabledReason={!settingsEditable || saving || contentBusy || cancelling ? settingsReason
                : !form.platform ? selectChannelReason
                  : form.platform !== "douyin" ? unsupportedReason
                    : noAccountReason}
              ariaLabel={t("选择发布账号", "Select publication account")}
              onChange={(value) => setForm({ ...form, channel_account_id: value })} />
            <small>{!form.platform
              ? selectChannelReason
              : channelAccounts.length
                ? t("仅显示当前项目中该渠道已连接的账号。", "Only connected accounts for this channel in this project are listed.")
                : t("此渠道暂无已连接的账号。", "No connected accounts for this channel.")}
              {" "}<Link href={`/projects/${encodeURIComponent(plan.project_id)}`}>{t(CHINESE_ACTIONS.connect, ENGLISH_ACTIONS.connect)}</Link></small>
          </label>
          <div className="amp-publication-schedule" role="group" aria-labelledby="publication-schedule-heading">
            <div className="amp-publication-schedule-heading">
              <span id="publication-schedule-heading">{t("发布时间", "Publish time")}</span>
            </div>
            <div className="amp-publication-schedule-fields">
              <label>
                <span>{t("日期", "Date")}</span>
                <PublicationSchedulePicker kind="date" value={scheduledDate} disabled={!settingsEditable || saving || contentBusy || cancelling} blockedReason={settingsReason}
                  onChange={(value) => setForm({ ...form, scheduled_for: publicationScheduleInput(value, scheduledTime) })} />
              </label>
              <label>
                <span>{t("时间", "Time")}</span>
                <PublicationSchedulePicker kind="time" value={scheduledTime} disabled={!settingsEditable || saving || contentBusy || cancelling} blockedReason={settingsReason}
                  onChange={(value) => setForm({ ...form, scheduled_for: publicationScheduleInput(scheduledDate, value) })} />
              </label>
            </div>
          </div>
          {plan.missing_scope && <p className="amp-publication-settings-notice">
            {t("此账号尚缺少平台发布权限：{scope}", "This account lacks publishing permission: {scope}", { scope: plan.missing_scope })}
          </p>}
          <div className="amp-publication-settings-actions">
          {settingsEditable && <GuardedButton blockedReason={busyReason} type="button" className="amp-button amp-button-secondary amp-button-cancel"
            disabled={saving} onClick={() => settingsDialog.current?.close()}>
            {t(CHINESE_ACTIONS.cancel, ENGLISH_ACTIONS.cancel)}
          </GuardedButton>}
          {canManage && publicationHasScheduledRelease(plan.status, plan.scheduled_for) && <GuardedButton blockedReason={busyReason} type="button" className="amp-button amp-button-secondary"
            disabled={saving || contentBusy || cancelling}
            onClick={() => { settingsDialog.current?.close(); setConfirmCancel(true); }}>
            {t("取消定时发布", "Cancel scheduled publication")}
          </GuardedButton>}
          {settingsEditable && <GuardedButton blockedReason={saveReason} type="submit" className="amp-button amp-button-primary"
            disabled={Boolean(saveReason)}>
            {saving ? t(CHINESE_PROGRESS.saving, ENGLISH_PROGRESS.saving) : t(CHINESE_ACTIONS.save, ENGLISH_ACTIONS.save)}
          </GuardedButton>}
          </div>
        </form>
        </dialog>
        <DeleteConfirmDialog open={confirmCancel}
          title={t("取消发布", "Cancel publication")}
          message={t("确认取消“{title}”的定时发布吗？媒体和文案将保留。",
            "Cancel the scheduled publication for “{title}”? Media and copy will be retained.",
            { title: plan.name })}
          cancelLabel={t(CHINESE_ACTIONS.cancel, ENGLISH_ACTIONS.cancel)} confirmLabel={t("取消发布", `${ENGLISH_ACTIONS.cancel} publication`)}
          busyLabel={t(CHINESE_PROGRESS.cancelling, ENGLISH_PROGRESS.cancelling)} busy={cancelling}
          onCancel={() => { setConfirmCancel(false); settingsDialog.current?.showModal(); }}
          onConfirm={() => void cancelPlan()} />
      </main>
    </div>
  );
}
