"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import OpinionOverviewPanel from "@/components/lead_tracking/OpinionOverviewPanel";
import OpinionEvidenceSections from "@/components/lead_tracking/OpinionEvidenceSections";
import { useLeadTrackingEntities } from "@/components/lead_tracking/useLeadTrackingEntities";
import { useI18n } from "@/contexts/i18n_context";
import { localizeErrorMessage } from "@/i18n/errors";
import {
  fetch_opinion_actions, fetch_opinion_details, fetch_opinion_overview,
  generate_opinion_strategy,
} from "@/services/lead_tracking_api";
import type { OpinionActionSummary, OpinionDetails, OpinionOverview, OpinionStrategy } from "@/types/lead_tracking";

export default function OpinionMonitoringPage() {
  return <Suspense fallback={<div className="amp-page-state" role="status">Loading...</div>}><OpinionMonitoringWorkspace /></Suspense>;
}

function OpinionMonitoringWorkspace() {
  const router = useRouter();
  const params = useSearchParams();
  const { t, locale } = useI18n();
  const { user, authLoading, projects, accounts, loading, error, retry } = useLeadTrackingEntities();
  const [attempt, setAttempt] = useState(0);
  const [overviewState, setOverviewState] = useState<{
    key: string; loading: boolean; error: string; data: OpinionOverview | null;
  }>({ key: "", loading: false, error: "", data: null });
  const [actionsState, setActionsState] = useState<{
    key: string; loading: boolean; error: string; data: OpinionActionSummary | null;
  }>({ key: "", loading: false, error: "", data: null });
  const [detailsState, setDetailsState] = useState<{
    key: string; loading: boolean; error: string; data: OpinionDetails | null;
  }>({ key: "", loading: false, error: "", data: null });
  const [strategy, setStrategy] = useState<OpinionStrategy | null>(null);
  const [strategyBusy, setStrategyBusy] = useState(false);
  const [strategyError, setStrategyError] = useState("");
  const [activeSection, setActiveSection] = useState<"overview" | "performance" | "comments" | "risks">("overview");

  const projectId = projects.some((project) => project.id === params.get("project"))
    ? params.get("project") || "" : accounts[0]?.project_id || projects[0]?.id || "";
  const scopedAccounts = useMemo(() => accounts.filter((account) => account.project_id === projectId), [accounts, projectId]);
  const accountId = scopedAccounts.some((account) => account.id === params.get("account"))
    ? params.get("account") || "" : scopedAccounts[0]?.id || "";
  const days: 7 | 30 = params.get("days") === "30" ? 30 : 7;
  const scopeKey = `${projectId}:${accountId}:${days}:${attempt}`;
  const currentScope = useRef(scopeKey);
  useEffect(() => { currentScope.current = scopeKey; }, [scopeKey]);
  const account = scopedAccounts.find((item) => item.id === accountId);
  const overview = overviewState.key === scopeKey ? overviewState.data : null;
  const actions = actionsState.key === scopeKey ? actionsState.data : null;
  const details = detailsState.key === scopeKey ? detailsState.data : null;

  useEffect(() => {
    if (!authLoading && !user) router.replace("/");
  }, [authLoading, router, user]);
  useEffect(() => {
    setStrategy(null);
    setStrategyError("");
  }, [projectId, accountId, days]);
  useEffect(() => {
    if (!user || !projectId || !accountId) return;
    const controller = new AbortController();
    let active = true;
    setOverviewState({ key: scopeKey, loading: true, error: "", data: null });
    void fetch_opinion_overview(projectId, accountId, days, controller.signal)
      .then((response) => { if (active) setOverviewState({ key: scopeKey, loading: false, error: "", data: response.data }); })
      .catch((failure: unknown) => { if (active) setOverviewState({ key: scopeKey, loading: false, data: null,
        error: localizeErrorMessage(failure instanceof Error ? failure.message : "Could not load opinion overview", locale) }); });
    return () => { active = false; controller.abort(); };
  }, [user, projectId, accountId, days, scopeKey, locale]);
  useEffect(() => {
    if (!user || !projectId || !accountId) return;
    const controller = new AbortController();
    let active = true;
    setDetailsState({ key: scopeKey, loading: true, error: "", data: null });
    void fetch_opinion_details(projectId, accountId, days, controller.signal)
      .then((response) => { if (active) setDetailsState({ key: scopeKey, loading: false, error: "", data: response.data }); })
      .catch((failure: unknown) => { if (active) setDetailsState({ key: scopeKey, loading: false, data: null,
        error: localizeErrorMessage(failure instanceof Error ? failure.message : "Could not load opinion details", locale) }); });
    return () => { active = false; controller.abort(); };
  }, [user, projectId, accountId, days, scopeKey, locale]);
  useEffect(() => {
    if (!user || !projectId || !accountId) return;
    const controller = new AbortController();
    let active = true;
    setActionsState({ key: scopeKey, loading: true, error: "", data: null });
    void fetch_opinion_actions(projectId, accountId, days, controller.signal)
      .then((response) => { if (active) setActionsState({ key: scopeKey, loading: false, error: "", data: response.data }); })
      .catch((failure: unknown) => { if (active) setActionsState({ key: scopeKey, loading: false, data: null,
        error: localizeErrorMessage(failure instanceof Error ? failure.message : "Could not load opinion actions", locale) }); });
    return () => { active = false; controller.abort(); };
  }, [user, projectId, accountId, days, scopeKey, locale]);

  function changeScope(project: string, selectedAccount: string, period: 7 | 30) {
    const query = new URLSearchParams();
    if (project) query.set("project", project);
    if (selectedAccount) query.set("account", selectedAccount);
    query.set("days", String(period));
    router.replace(`/opinion_tracking?${query}`);
  }
  function scrollToSection(section: "overview" | "performance" | "comments" | "risks") {
    const sectionIds = {
      overview: "opinion-page-title", performance: "opinion-performance-title",
      comments: "opinion-voices-title", risks: "opinion-strategy-title",
    };
    setActiveSection(section);
    document.getElementById(sectionIds[section])?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  async function createStrategy() {
    if (!projectId || !accountId || strategyBusy) return;
    const requestedScope = scopeKey;
    setStrategyBusy(true);
    setStrategyError("");
    try {
      const response = await generate_opinion_strategy(projectId, accountId, days);
      if (currentScope.current === requestedScope) {
        setStrategy(response.data);
        scrollToSection("risks");
      }
    } catch {
      if (currentScope.current === requestedScope) {
        setStrategyError(t("生成失败，请稍后重试。", "Could not generate. Please try again."));
        scrollToSection("risks");
      }
    } finally {
      setStrategyBusy(false);
    }
  }
  function exportData() {
    if (!details) return;
    const rows = [["评论编号", "平台", "账号", "时间", "评论内容", "情绪标签", "话题", "点赞", "回复"],
      ...details.comments.map((comment) => [comment.comment_id, comment.platform, account?.account_name || "",
        comment.created_at, comment.content, comment.mood, comment.topic, comment.likes, comment.replies])];
    const csv = "\uFEFF" + rows.map((row) => row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `marventa-opinion-comments-${accountId}-${days}d.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  if (authLoading || !user) return <div className="amp-page-state" role="status">{t("加载中…", "Loading…")}</div>;
  return <div className="amp-projects-layout amp-opinion-shell">
    <main className="amp-projects-main amp-opinion-workspace">
      <nav className="amp-opinion-breadcrumb" aria-label={t("位置", "Breadcrumb")}>
        <span>{t("运营", "Operations")}</span>
        <span>›</span><strong>{t("舆论追踪", "Opinion tracking")}</strong>
      </nav>
      <header className="amp-opinion-page-heading">
        <div className="amp-opinion-heading-title"><span className="amp-opinion-heading-symbol" aria-hidden="true">⌁</span>
          <h1 id="opinion-page-title">{t("舆论追踪", "Opinion tracking")}</h1></div>
        <div className="amp-opinion-heading-actions">
          <button type="button" className="amp-opinion-export" onClick={exportData}>{t("导出数据", "Export data")}</button>
          <button type="button" className="amp-opinion-generate" onClick={() => { void createStrategy(); }}>
            {strategyBusy ? t("生成中…", "Generating…") : t("生成 AI 策略建议", "Generate AI strategy")}
          </button>
        </div>
      </header>
      {loading ? <div className="amp-page-state" role="status">{t("加载中…", "Loading…")}</div>
        : error ? <div className="amp-opinion-state" role="alert">{error}<button type="button" onClick={retry}>{t("重试", "Retry")}</button></div>
          : <>
            <div className="amp-opinion-scope">
              <label>{t("项目", "Project")}
                <select value={projectId} onChange={(event) => changeScope(event.target.value, "", days)}>
                  {projects.map((project) => <option key={project.id} value={project.id}>{project.title}</option>)}
                </select>
              </label>
              <label>{t("平台账号", "Platform account")}
                <select value={accountId} onChange={(event) => changeScope(projectId, event.target.value, days)}>
                  {scopedAccounts.map((item) => <option key={item.id} value={item.id}>
                    {item.platform === "douyin" ? t("抖音", "Douyin") : t("小红书", "Xiaohongshu")} · {item.account_name}
                  </option>)}
                </select>
              </label>
              <label>{t("周期", "Period")}
                <select value={days} onChange={(event) => changeScope(projectId, accountId, Number(event.target.value) as 7 | 30)}>
                  <option value={7}>{t("近 7 天", "Last 7 days")}</option>
                  <option value={30}>{t("近 30 天", "Last 30 days")}</option>
                </select>
              </label>
              <button type="button" className="amp-opinion-refresh" aria-label={t("刷新舆情监测", "Refresh opinion monitoring")}
                onClick={() => setAttempt((value) => value + 1)}>↻</button>
            </div>
            <nav className="amp-opinion-tabs" aria-label={t("舆情监测页面", "Opinion views")}>
              {([[
                "overview", t("监测总览", "Overview")], ["performance", t("推广表现", "Promotion performance")],
                ["comments", t("评论舆情", "Comment sentiment")],
                ["risks", t("策略建议", "Strategy advice")],
              ] as const).map(([key, label]) => <button key={key} type="button"
                className={activeSection === key ? "is-active" : ""} onClick={() => scrollToSection(key)}>{label}</button>)}
              {account && <Link href={`/lead_tracking/${encodeURIComponent(accountId)}?project=${encodeURIComponent(projectId)}&tab=analysis`}>
                {t("机会线索", "Opportunities")}</Link>}
            </nav>
            {!account ? <div className="amp-opinion-state" role="status">{t("该项目暂无可用账号。", "This project has no available account.")}</div>
              : <>
                <OpinionOverviewPanel data={overview} performance={details?.performance || null}
                  loading={overviewState.key !== scopeKey || overviewState.loading}
                  error={overviewState.key === scopeKey ? overviewState.error : ""}
                  onRetry={() => setAttempt((value) => value + 1)} />
                <OpinionEvidenceSections key={scopeKey}
                  details={details} loading={detailsState.key !== scopeKey || detailsState.loading}
                  error={detailsState.key === scopeKey ? detailsState.error : ""}
                  onRetry={() => setAttempt((value) => value + 1)} actions={actions}
                  strategy={strategy} strategyBusy={strategyBusy} strategyError={strategyError} />
              </>}
          </>}
    </main>
  </div>;
}
