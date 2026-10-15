"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useI18n } from "@/contexts/i18n_context";
import { useToast } from "@/contexts/toast_context";
import CommentInsightPanel from "@/components/lead_tracking/CommentInsightPanel";
import LeadAnalysisPanel from "@/components/lead_tracking/LeadAnalysisPanel";
import DailyReportPanel from "@/components/lead_tracking/DailyReportPanel";
import InlineIcon from "@/components/redesign/InlineIcon";
import { GuardedButton } from "@/components/redesign/GuardedControls";
import type { AccountContentAccount } from "@/types/account_content";
import {
  fetch_daily_comment_report,
  fetch_lead_tracking_analysis,
  fetch_lead_tracking_comment_insight,
  review_lead_tracking_item,
  run_lead_tracking_analysis,
} from "@/services/lead_tracking_api";
import { localizeErrorMessage } from "@/i18n/errors";
import { groupLeadTrackingEntities } from "@/utils/lead_tracking";
import type {
  DailyCommentReport,
  LeadReviewStatus,
  LeadTrackingAnalysis,
  LeadTrackingCommentInsight,
} from "@/types/lead_tracking";

export default function AccountAnalysisDialog({ accountId, projectId, accounts, initialTab = "", initialDate = "", onClose }: {
  accountId: string;
  projectId: string;
  accounts: AccountContentAccount[];
  initialTab?: string;
  initialDate?: string;
  onClose: () => void;
}) {
  const { t, locale } = useI18n();
  const { showError, showSuccess } = useToast();
  const [tab, setTab] = useState<"comments" | "analysis" | "report">(
    initialTab === "report" ? "report" : initialTab === "analysis" ? "analysis" : "comments",
  );
  const [commentAttempt, setCommentAttempt] = useState(0);
  const [analysisAttempt, setAnalysisAttempt] = useState(0);
  const [reportAttempt, setReportAttempt] = useState(0);
  const [reportDate, setReportDate] = useState(initialDate);
  const [analysisDate, setAnalysisDate] = useState(initialDate);
  const [analyzing, setAnalyzing] = useState(false);
  const [reviewingCommentId, setReviewingCommentId] = useState("");
  const [commentState, setCommentState] = useState<{
    key: string; loading: boolean; error: string; data: LeadTrackingCommentInsight | null;
  }>({ key: "", loading: false, error: "", data: null });
  const [analysisState, setAnalysisState] = useState<{
    key: string; loading: boolean; error: string; data: LeadTrackingAnalysis | null;
  }>({ key: "", loading: false, error: "", data: null });
  const [reportState, setReportState] = useState<{
    key: string; loading: boolean; error: string; data: DailyCommentReport | null;
  }>({ key: "", loading: false, error: "", data: null });
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const busy = analyzing || Boolean(reviewingCommentId);
  const close = () => {
    if (busy) {
      showError(t("操作正在处理中，请稍候。", "An operation is in progress. Please wait."));
      return;
    }
    onClose();
  };
  const account = accounts.find((item) => item.id === accountId && item.project_id === projectId);
  const accountEntity = account
    ? groupLeadTrackingEntities(accounts).find((entity) =>
      entity.bindings.some((binding) =>
        binding.id === account.id && binding.project_id === account.project_id))
    : undefined;
  const projectName = account?.project_title || "";
  const accountKey = accountEntity?.key;
  useEffect(() => {
    const element = dialog.current;
    const trigger = Array.from(document.querySelectorAll<HTMLAnchorElement>(".amp-opinion-account-list a[data-account-key]"))
      .find((link) => link.dataset.accountKey === accountKey);
    if (element && !element.open) element.showModal();
    return () => {
      if (element?.open) element.close();
      window.requestAnimationFrame(() => {
        if (trigger?.isConnected && !document.querySelector("dialog[open]")) trigger.focus({ preventScroll: true });
      });
    };
  }, [accountKey]);
  const commentKey = `${projectId}:${accountId}:${commentAttempt}`;
  const analysisKey = `${projectId}:${accountId}:${analysisDate}:${analysisAttempt}`;
  const reportKey = `${projectId}:${accountId}:${reportDate}:${reportAttempt}`;
  useEffect(() => {
    if (!account) return;
    const controller = new AbortController();
    let active = true;
    setCommentState({ key: commentKey, loading: true, error: "", data: null });
    void fetch_lead_tracking_comment_insight(projectId, accountId, "", controller.signal)
      .then((response) => {
        if (active) setCommentState({ key: commentKey, loading: false, error: "", data: response.data });
      })
      .catch((error: unknown) => {
        if (active) setCommentState({ key: commentKey, loading: false, data: null,
          error: localizeErrorMessage(error instanceof Error ? error.message : "Could not load daily comment insights", locale) });
      });
    return () => { active = false; controller.abort(); };
  }, [account, accountId, commentKey, locale, projectId]);
  useEffect(() => {
      if (!account || tab !== "analysis") return;
      const controller = new AbortController();
      let active = true;
      setAnalysisState({ key: analysisKey, loading: true, error: "", data: null });
      void fetch_lead_tracking_analysis(projectId, accountId, analysisDate, controller.signal)
        .then((response) => {
          if (active) setAnalysisState({ key: analysisKey, loading: false, error: "", data: response.data });
        })
        .catch((error: unknown) => {
          if (active) setAnalysisState({ key: analysisKey, loading: false, data: null,
            error: localizeErrorMessage(error instanceof Error ? error.message : "Could not load intent evaluation", locale) });
        });
      return () => { active = false; controller.abort(); };
  }, [account, accountId, analysisDate, analysisKey, locale, projectId, tab]);
  useEffect(() => {
    if (!account || tab !== "report") return;
    const controller = new AbortController();
    let active = true;
    setReportState({ key: reportKey, loading: true, error: "", data: null });
    void fetch_daily_comment_report(projectId, accountId, reportDate, controller.signal)
      .then((response) => {
        if (!active) return;
        setReportState({ key: reportKey, loading: false, error: "", data: response.data });
        if (!reportDate) setReportDate(response.data.date);
      })
      .catch((error: unknown) => {
        if (active) setReportState({ key: reportKey, loading: false, data: null,
          error: localizeErrorMessage(error instanceof Error ? error.message : "Could not load daily report", locale) });
      });
    return () => { active = false; controller.abort(); };
  }, [account, accountId, locale, projectId, reportDate, reportKey, tab]);
  const commentData = commentState.key === commentKey ? commentState.data : null;
  const analysisData = analysisState.key === analysisKey ? analysisState.data : null;
  const reportData = reportState.key === reportKey ? reportState.data : null;
  const canAnalyze = Boolean(
      commentData
      && ["completed", "partial"].includes(commentData.status)
      && commentData.items.length,
  );
  const blockedReason = analyzing
      ? t("分析正在进行中。", "Analysis is in progress.")
      : t("需要先完成评论同步并获取至少一条评论。", "A completed comment snapshot with at least one comment is required.");
  async function analyze() {
      if (!canAnalyze || analyzing) return;
      setAnalyzing(true);
      try {
        const response = await run_lead_tracking_analysis(projectId, accountId, analysisDate);
        setAnalysisState({ key: analysisKey, loading: false, error: "", data: response.data });
        showSuccess(t("意向评估已完成", "Intent evaluation completed"));
      } catch (error) {
        showError(localizeErrorMessage(error instanceof Error ? error.message : "Could not analyze comments", locale));
      } finally {
        setAnalyzing(false);
      }
  }
  async function reviewLead(commentId: string, status: LeadReviewStatus) {
      if (reviewingCommentId) return;
      setReviewingCommentId(commentId);
      try {
        const response = await review_lead_tracking_item(projectId, accountId, commentId, status, analysisDate);
        setAnalysisState({ key: analysisKey, loading: false, error: "", data: response.data });
        showSuccess(t("人工确认状态已更新", "Review status updated"));
      } catch (error) {
        showError(localizeErrorMessage(error instanceof Error ? error.message : "Could not update lead review", locale));
      } finally {
        setReviewingCommentId("");
      }
  }
  return (
    <dialog ref={dialog} aria-labelledby={titleId}
      className="amp-workspace-dialog amp-account-analysis-dialog"
      onCancel={(event) => { event.preventDefault(); close(); }}
      onKeyDown={(event) => {
        if (event.key === "Escape" && event.target instanceof HTMLElement
          && !event.target.closest('[role="listbox"]')) {
          event.preventDefault();
          event.stopPropagation();
          close();
        }
      }}
      onClick={(event) => {
        if (event.target !== event.currentTarget) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        if (event.clientX < bounds.left || event.clientX > bounds.right
          || event.clientY < bounds.top || event.clientY > bounds.bottom) close();
      }}>
      <header className="amp-account-analysis-header">
        <div className="amp-account-analysis-title">
          <h2 id={titleId} title={account?.account_name}>{account?.account_name || t("账号分析", "Account analysis")}</h2>
          {account && <p>{projectName}</p>}
        </div>
        <GuardedButton type="button" className="amp-modal-close" aria-label={t("关闭账号分析", "Close account analysis")}
          disabled={busy} blockedReason={t("操作正在处理中，请稍候。", "An operation is in progress. Please wait.")}
          onClick={close}><InlineIcon name="close" /></GuardedButton>
      </header>
      {!account ? <div className="amp-projects-state" role="alert">
        <strong>{t("账号不存在或你没有访问权限。", "The account does not exist or is not accessible.")}</strong>
      </div> : <>
        <div className="amp-account-analysis-navigation">
        <div className="amp-project-detail-tabs" role="tablist" aria-label={t("账号分析", "Account analysis")}>
          <button type="button" role="tab" aria-selected={tab === "comments"} id="lead-comments-tab"
            aria-controls="lead-comments-panel" onClick={() => setTab("comments")}>
            {t("评论洞察", "Comment insights")}
          </button>
          <button type="button" role="tab" aria-selected={tab === "analysis"} id="lead-analysis-tab"
            aria-controls="lead-analysis-panel" onClick={() => { setAnalysisDate(initialDate); setTab("analysis"); }}>
            {t("意向评估", "Intent evaluation")}
          </button>
          <button type="button" role="tab" aria-selected={tab === "report"} id="lead-report-tab"
            aria-controls="lead-report-panel" onClick={() => setTab("report")}>
            {t("每日简报", "Daily report")}
          </button>
        </div>
          {tab === "analysis" && analysisData?.status === "failed"
            && <GuardedButton type="button" className="amp-button amp-button-primary"
            disabled={!canAnalyze || analyzing} blockedReason={blockedReason} onClick={() => { void analyze(); }}>
            {analyzing ? t("重新分析中…", "Reanalyzing…") : t("重新分析", "Reanalyze")}
          </GuardedButton>}
        </div>
        <div className="amp-account-analysis-body">
        {tab === "comments" ? (
          <section className="amp-lead-tracking-panel" role="tabpanel" id="lead-comments-panel" aria-labelledby="lead-comments-tab">
            <CommentInsightPanel
              data={commentState.key === commentKey ? commentState.data : null}
              loading={commentState.key !== commentKey || commentState.loading}
              error={commentState.key === commentKey ? commentState.error : ""}
              onRetry={() => setCommentAttempt((value) => value + 1)} />
          </section>
        ) : tab === "analysis" ? (
          <section className="amp-lead-tracking-panel" role="tabpanel" id="lead-analysis-panel" aria-labelledby="lead-analysis-tab">
            <LeadAnalysisPanel
              data={analysisData}
              loading={analysisState.key !== analysisKey || analysisState.loading}
              error={analysisState.key === analysisKey ? analysisState.error : ""}
              onRetry={() => setAnalysisAttempt((value) => value + 1)}
              onReview={(commentId, status) => { void reviewLead(commentId, status); }}
              reviewingCommentId={reviewingCommentId} />
          </section>
        ) : tab === "report" ? (
          <section className="amp-lead-tracking-panel" role="tabpanel" id="lead-report-panel" aria-labelledby="lead-report-tab">
            <DailyReportPanel
              report={reportData}
              loading={reportState.key !== reportKey || reportState.loading}
              error={reportState.key === reportKey ? reportState.error : ""}
              onRetry={() => setReportAttempt((value) => value + 1)} />
          </section>
        ) : null}
        </div>
      </>}
    </dialog>
  );
}
