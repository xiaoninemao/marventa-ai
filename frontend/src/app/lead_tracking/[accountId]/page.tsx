"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useI18n } from "@/contexts/i18n_context";
import { useToast } from "@/contexts/toast_context";
import { useLeadTrackingEntities } from "@/components/lead_tracking/useLeadTrackingEntities";
import CommentInsightPanel from "@/components/lead_tracking/CommentInsightPanel";
import LeadAnalysisPanel from "@/components/lead_tracking/LeadAnalysisPanel";
import DailyReportPanel from "@/components/lead_tracking/DailyReportPanel";
import PublishingProjectSidebar from "@/components/publishing/PublishingProjectSidebar";
import InlineIcon from "@/components/redesign/InlineIcon";
import { GuardedButton, GuardedSelect } from "@/components/redesign/GuardedControls";
import { CHINESE_PROGRESS, ENGLISH_PROGRESS } from "@/i18n/interaction_copy";
import {
  download_daily_comment_report,
  fetch_daily_comment_report,
  fetch_daily_report_dates,
  fetch_lead_tracking_analysis,
  fetch_lead_tracking_comment_insight,
  fetch_lead_tracking_works,
  review_lead_tracking_item,
  review_daily_report_comment,
  run_lead_tracking_analysis,
} from "@/services/lead_tracking_api";
import { localizeErrorMessage } from "@/i18n/errors";
import { groupLeadTrackingEntities } from "@/utils/lead_tracking";
import type {
  DailyCommentReport,
  LeadReviewStatus,
  LeadTrackingAnalysis,
  LeadTrackingCommentInsight,
  LeadTrackingWork,
} from "@/types/lead_tracking";

export default function LeadTrackingDetailPage() {
  return <Suspense fallback={<div className="amp-page-state" role="status">Loading...</div>}><LeadTrackingWorkspace /></Suspense>;
}

function LeadTrackingWorkspace() {
  const { accountId } = useParams<{ accountId: string }>();
  const params = useSearchParams();
  const router = useRouter();
  const { t, locale } = useI18n();
  const { showError, showSuccess } = useToast();
  const [tab, setTab] = useState<"comments" | "analysis" | "report">(
    params.get("tab") === "report" ? "report" : "comments",
  );
  const [commentAttempt, setCommentAttempt] = useState(0);
  const [workAttempt, setWorkAttempt] = useState(0);
  const [selectedWorkId, setSelectedWorkId] = useState("");
  const [analysisAttempt, setAnalysisAttempt] = useState(0);
  const [reportAttempt, setReportAttempt] = useState(0);
  const [reportDate, setReportDate] = useState(params.get("date") || "");
  const [analysisDate, setAnalysisDate] = useState("");
  const [reportDates, setReportDates] = useState<string[]>([]);
  const [busyComment, setBusyComment] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [reviewingCommentId, setReviewingCommentId] = useState("");
  const [commentState, setCommentState] = useState<{
    key: string; loading: boolean; error: string; data: LeadTrackingCommentInsight | null;
  }>({ key: "", loading: false, error: "", data: null });
  const [workState, setWorkState] = useState<{
    key: string; loading: boolean; error: string; data: LeadTrackingWork[];
  }>({ key: "", loading: false, error: "", data: [] });
  const [analysisState, setAnalysisState] = useState<{
    key: string; loading: boolean; error: string; data: LeadTrackingAnalysis | null;
  }>({ key: "", loading: false, error: "", data: null });
  const [reportState, setReportState] = useState<{
    key: string; loading: boolean; error: string; data: DailyCommentReport | null;
  }>({ key: "", loading: false, error: "", data: null });
  useEffect(() => {
    if (params.get("tab") === "report") setTab("report");
    if (params.get("date")) setReportDate(params.get("date") || "");
  }, [params]);
  const projectId = params.get("project") || "";
  useEffect(() => {
    if (params.get("tab") === "opinion" && projectId) {
      router.replace(`/opinion_tracking?project=${encodeURIComponent(projectId)}&account=${encodeURIComponent(accountId)}`);
    }
  }, [accountId, params, projectId, router]);
  const { user, authLoading, projects, accounts, loading, error, retry } = useLeadTrackingEntities();
  useEffect(() => {
    if (!authLoading && !user) router.replace("/");
  }, [authLoading, router, user]);
  const back = projectId ? `/lead_tracking?project=${encodeURIComponent(projectId)}` : "/lead_tracking";
  const account = accounts.find((item) => item.id === accountId && item.project_id === projectId);
  const accountEntity = account
    ? groupLeadTrackingEntities(accounts).find((entity) =>
      entity.bindings.some((binding) =>
        binding.id === account.id && binding.project_id === account.project_id))
    : undefined;
  const projectNames = accountEntity?.bindings.map((binding) => binding.project_title).join("、")
    || account?.project_title || "";
  const workKey = `${projectId}:${accountId}:${workAttempt}`;
  const commentKey = `${projectId}:${accountId}:${selectedWorkId}:${commentAttempt}`;
  const analysisKey = `${projectId}:${accountId}:${analysisDate}:${analysisAttempt}`;
  const reportKey = `${projectId}:${accountId}:${reportDate}:${reportAttempt}`;
  useEffect(() => { setSelectedWorkId(""); }, [projectId, accountId]);
  useEffect(() => {
    if (!user || !account) return;
    const controller = new AbortController();
    let active = true;
    setWorkState({ key: workKey, loading: true, error: "", data: [] });
    void fetch_lead_tracking_works(projectId, accountId, controller.signal)
      .then((works) => {
        if (active) setWorkState({ key: workKey, loading: false, error: "", data: works });
      })
      .catch((error: unknown) => {
        if (active) setWorkState({ key: workKey, loading: false, data: [],
          error: localizeErrorMessage(error instanceof Error ? error.message : "Could not load account works", locale) });
      });
    return () => { active = false; controller.abort(); };
  }, [account, accountId, locale, projectId, user, workKey]);
  useEffect(() => {
    if (!user || !account) return;
    const controller = new AbortController();
    let active = true;
    setCommentState({ key: commentKey, loading: true, error: "", data: null });
    void fetch_lead_tracking_comment_insight(projectId, accountId, "", controller.signal, selectedWorkId)
      .then((response) => {
        if (active) setCommentState({ key: commentKey, loading: false, error: "", data: response.data });
      })
      .catch((error: unknown) => {
        if (active) setCommentState({ key: commentKey, loading: false, data: null,
          error: localizeErrorMessage(error instanceof Error ? error.message : "Could not load daily comment insights", locale) });
      });
    return () => { active = false; controller.abort(); };
  }, [account, accountId, commentKey, locale, projectId, selectedWorkId, user]);
  useEffect(() => {
      if (!user || !account || tab !== "analysis") return;
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
  }, [account, accountId, analysisDate, analysisKey, locale, projectId, tab, user]);
  useEffect(() => {
    if (!user || !account || tab !== "report") return;
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
    void fetch_daily_report_dates(projectId, accountId).then((dates) => {
      if (active) setReportDates(dates);
    }).catch(() => { /* The selected report remains accessible when history is unavailable. */ });
    return () => { active = false; controller.abort(); };
  }, [account, accountId, locale, projectId, reportDate, reportKey, tab, user]);
  const commentData = commentState.key === commentKey ? commentState.data : null;
  const works = workState.key === workKey ? workState.data : [];
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
  async function reviewComment(commentId: string, stance: "support" | "oppose" | "neutral" | "uncertain") {
    if (busyComment) return;
    setBusyComment(commentId);
    try {
      const response = await review_daily_report_comment(projectId, accountId, reportDate, commentId, stance);
      setReportState({ key: reportKey, loading: false, error: "", data: response.data });
      showSuccess(t("评论观点已人工复核", "Comment stance reviewed"));
    } catch (error) {
      showError(localizeErrorMessage(error instanceof Error ? error.message : "Could not review comment", locale));
    } finally {
      setBusyComment("");
    }
  }
  async function downloadReport(format: "md" | "json") {
    if (!reportData) return;
    try {
      const blob = await download_daily_comment_report(projectId, accountId, reportData.date, format, selectedWorkId);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `comment-report-${reportData.date}.${format}`;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      showError(localizeErrorMessage(error instanceof Error ? error.message : "Could not download report", locale));
    }
  }
  if (authLoading || !user || loading) return <div className="amp-page-state" role="status">{t(CHINESE_PROGRESS.loading, ENGLISH_PROGRESS.loading)}</div>;
  if (!projectId || error || !account) return <div className="amp-projects-state" role="alert">
    <strong>{!projectId ? t("请从列表选择渠道账号。", "Choose a channel account from the list.")
      : error || t("账号不存在或你没有访问权限。", "The account does not exist or is not accessible.")}</strong>
    <Link className="amp-button amp-button-secondary" href={back}>{t("返回", "Back")}</Link>
    {error && <button type="button" className="amp-button amp-button-secondary" onClick={retry}>{t("重试", "Retry")}</button>}
  </div>;
  return (
    <div className="amp-project-detail-layout">
      <PublishingProjectSidebar module="leadTracking" projects={projects} selectedProjectId={projectId} />
      <main className="amp-project-detail-main">
        <header className="amp-project-detail-header">
          <div className="amp-project-detail-title">
            <Link href={back} className="amp-project-detail-back" aria-label={t("返回线索追踪", "Back to Lead Tracking")}><InlineIcon name="arrowLeft" /></Link>
            <div><h1>{account.account_name}</h1><p>{account.platform === "douyin" ? t("抖音", "Douyin") : t("小红书", "Xiaohongshu")} / {projectNames}</p></div>
          </div>
          {tab === "analysis" && analysisData?.status === "failed"
            && <GuardedButton type="button" className="amp-button amp-button-primary"
            disabled={!canAnalyze || analyzing} blockedReason={blockedReason} onClick={() => { void analyze(); }}>
            {analyzing ? t("重新分析中…", "Reanalyzing…") : t("重新分析", "Reanalyze")}
          </GuardedButton>}
        </header>
        <div className="amp-lead-work-context">
          <label htmlFor="lead-work-select">{t("作品", "Work")}</label>
          <GuardedSelect id="lead-work-select" value={selectedWorkId}
            disabled={workState.key !== workKey || workState.loading}
            blockedReason={t("作品正在加载，请稍候。", "Works are loading. Please wait.")}
            onChange={(event) => setSelectedWorkId(event.target.value)}>
            <option value="">{t("全部作品", "All works")}</option>
            {works.map((work) => <option key={work.item_id} value={work.item_id}>{work.title || work.item_id}</option>)}
          </GuardedSelect>
          {workState.key === workKey && workState.error && <button type="button"
            onClick={() => setWorkAttempt((value) => value + 1)}>{t("重试", "Retry")}</button>}
        </div>
        <div className="amp-project-detail-tabs" role="tablist" aria-label={t("线索工作区", "Lead workspace")}>
          <button type="button" role="tab" aria-selected={tab === "comments"} id="lead-comments-tab"
            aria-controls="lead-comments-panel" onClick={() => setTab("comments")}>
            {t("评论洞察", "Comment insights")}
          </button>
          <button type="button" role="tab" aria-selected={tab === "analysis"} id="lead-analysis-tab"
            aria-controls="lead-analysis-panel" onClick={() => { setAnalysisDate(""); setTab("analysis"); }}>
            {t("意向评估", "Intent evaluation")}
          </button>
          <button type="button" role="tab" aria-selected={tab === "report"} id="lead-report-tab"
            aria-controls="lead-report-panel" onClick={() => setTab("report")}>
            {t("每日简报", "Daily report")}
          </button>
        </div>
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
              selectedWorkId={selectedWorkId}
              loading={analysisState.key !== analysisKey || analysisState.loading}
              error={analysisState.key === analysisKey ? analysisState.error : ""}
              onRetry={() => setAnalysisAttempt((value) => value + 1)}
              onReview={(commentId, status) => { void reviewLead(commentId, status); }}
              reviewingCommentId={reviewingCommentId} />
          </section>
        ) : tab === "report" ? (
          <section className="amp-lead-tracking-panel" role="tabpanel" id="lead-report-panel" aria-labelledby="lead-report-tab">
            <DailyReportPanel
              report={reportData} dates={reportDates} date={reportDate || reportData?.date || ""}
              selectedWorkId={selectedWorkId}
              loading={reportState.key !== reportKey || reportState.loading}
              error={reportState.key === reportKey ? reportState.error : ""}
              busyComment={busyComment} onDate={setReportDate}
              onRetry={() => setReportAttempt((value) => value + 1)}
              onDownload={(format) => { void downloadReport(format); }}
              onReviewComment={(commentId, stance) => { void reviewComment(commentId, stance); }} />
          </section>
        ) : null}
      </main>
    </div>
  );
}
