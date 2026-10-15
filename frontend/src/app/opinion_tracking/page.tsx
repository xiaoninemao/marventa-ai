"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import EnterpriseSelect from "@/components/redesign/EnterpriseSelect";
import { GuardedButton } from "@/components/redesign/GuardedControls";
import InlineIcon from "@/components/redesign/InlineIcon";
import WorkspaceEmptyState from "@/components/redesign/WorkspaceEmptyState";
import PublishingProjectSidebar from "@/components/publishing/PublishingProjectSidebar";
import AccountTrackingList from "@/components/lead_tracking/AccountTrackingList";
import AccountAnalysisDialog from "@/components/lead_tracking/AccountAnalysisDialog";
import OpinionProjectCard from "@/components/lead_tracking/OpinionProjectCard";
import OpinionOverviewPanel from "@/components/lead_tracking/OpinionOverviewPanel";
import OpinionEvidenceSections from "@/components/lead_tracking/OpinionEvidenceSections";
import { useLeadTrackingEntities } from "@/components/lead_tracking/useLeadTrackingEntities";
import { groupLeadTrackingEntities } from "@/utils/lead_tracking";
import { useI18n } from "@/contexts/i18n_context";
import { localizeErrorMessage } from "@/i18n/errors";
import { fetch_project_opinion_monitor, generate_project_opinion_strategy } from "@/services/lead_tracking_api";
import type { OpinionStrategy, ProjectOpinionMonitor } from "@/types/lead_tracking";

export default function OpinionTrackingPage() {
  return <Suspense fallback={<div className="amp-page-state" role="status">Loading...</div>}><OpinionTrackingWorkspace /></Suspense>;
}

function OpinionTrackingWorkspace() {
  const router = useRouter();
  const params = useSearchParams();
  const { t, locale } = useI18n();
  const { user, authLoading, projects, accounts, scope, loading, error, retry } = useLeadTrackingEntities();
  const projectId = params.get("project") || "";
  const project = projects.find((item) => item.id === projectId);
  const accountId = params.get("account") || "";
  const view = params.get("view") === "accounts" || accountId ? "accounts" : "overview";
  const days: 7 | 30 = params.get("days") === "30" ? 30 : 7;
  const [attempt, setAttempt] = useState(0);
  const scopeKey = `${scope}:${projectId}:${days}:${attempt}`;
  const [monitorState, setMonitorState] = useState<{
    key: string; loading: boolean; error: string; data: ProjectOpinionMonitor | null;
  }>({ key: "", loading: false, error: "", data: null });
  const [strategyState, setStrategyState] = useState<{ key: string; data: OpinionStrategy | null; error: string }>({
    key: "", data: null, error: "",
  });
  const [strategyBusy, setStrategyBusy] = useState(false);
  const currentScope = useRef(scopeKey);
  useEffect(() => { currentScope.current = scopeKey; }, [scopeKey]);
  const projectAccounts = useMemo(() => accounts.filter((item) => item.project_id === projectId), [accounts, projectId]);
  const accountCount = useMemo(() => groupLeadTrackingEntities(projectAccounts).length, [projectAccounts]);
  const monitor = monitorState.key === scopeKey ? monitorState.data : null;
  const strategy = strategyState.key === scopeKey ? strategyState.data : null;
  const strategyError = strategyState.key === scopeKey ? strategyState.error : "";
  const monitorLoading = monitorState.key !== scopeKey || monitorState.loading;

  useEffect(() => {
    if (!authLoading && !user) router.replace("/");
  }, [authLoading, router, user]);
  useEffect(() => {
    if (!user || !project || loading || view !== "overview") return;
    const controller = new AbortController();
    let active = true;
    setMonitorState({ key: scopeKey, loading: true, error: "", data: null });
    void fetch_project_opinion_monitor(projectId, days, controller.signal)
      .then((response) => {
        if (active) setMonitorState({ key: scopeKey, loading: false, error: "", data: response.data });
      })
      .catch((failure: unknown) => {
        if (active) setMonitorState({ key: scopeKey, loading: false, data: null,
          error: localizeErrorMessage(failure instanceof Error ? failure.message : "Could not load opinion overview", locale) });
      });
    return () => { active = false; controller.abort(); };
  }, [user, project, projectId, days, scopeKey, locale, loading, view]);

  function changeView(nextView: "overview" | "accounts", period: 7 | 30 = days) {
    const query = new URLSearchParams({ project: projectId, days: String(period) });
    if (nextView === "accounts") query.set("view", "accounts");
    router.replace(`/opinion_tracking?${query}`);
  }
  function closeAccount() {
    const query = new URLSearchParams(params.toString());
    for (const key of ["account", "tab", "date"]) query.delete(key);
    query.set("view", "accounts");
    router.replace(`/opinion_tracking?${query}`, { scroll: false });
  }
  async function createStrategy() {
    if (!project || !accountCount || strategyBusy) return;
    const requestedScope = scopeKey;
    setStrategyBusy(true);
    setStrategyState({ key: requestedScope, data: null, error: "" });
    try {
      const response = await generate_project_opinion_strategy(projectId, days);
      if (currentScope.current === requestedScope) setStrategyState({ key: requestedScope, data: response.data, error: "" });
    } catch (failure) {
      if (currentScope.current === requestedScope) setStrategyState({ key: requestedScope, data: null,
        error: localizeErrorMessage(failure instanceof Error ? failure.message : "Could not generate opinion strategy", locale) });
    } finally {
      setStrategyBusy(false);
    }
  }
  function exportData() {
    if (!monitor) return;
    const rows = [[t("评论编号", "Comment ID"), t("平台", "Platform"), t("账号", "Account"),
      t("时间", "Time"), t("评论内容", "Comment"), t("情绪标签", "Sentiment"),
      t("话题", "Topic"), t("点赞", "Likes"), t("回复", "Replies")],
    ...monitor.details.comments.map((comment) => [
      comment.comment_id, comment.platform, comment.account_name || "", comment.created_at,
      comment.content, comment.mood, comment.topic, comment.likes, comment.replies,
    ])];
    const csv = "\uFEFF" + rows.map((row) => row.map((value) =>
      `"${String(value).replaceAll('"', '""')}"`).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `marventa-opinion-project-${projectId}-${days}d.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  if (authLoading || !user) return <div className="amp-page-state" role="status">{t("加载中…", "Loading…")}</div>;
  return <div className="amp-projects-layout">
    <PublishingProjectSidebar module="leadTracking" projects={projects} selectedProjectId={projectId} />
    <main className="amp-projects-main amp-opinion-workspace">
      <header className={project ? "amp-project-detail-header amp-project-header-aligned" : "amp-projects-header"}>
        {project ? <div className="amp-project-detail-title">
          <Link href="/opinion_tracking" className="amp-project-detail-back"
            aria-label={t("返回全部项目", "Back to all projects")}><InlineIcon name="arrowLeft" /></Link>
          <span className="amp-project-avatar amp-project-custom-avatar"
            style={{ backgroundColor: project.avatar_color || "#bfdbfe" }}>
            <span className="amp-project-avatar-emoji">{project.avatar_icon || "💡"}</span>
          </span>
          <div><h1 title={project.title}>{project.title || t("未命名项目", "Untitled project")}</h1></div>
        </div> : <div><h1 className="amp-module-title">{t("舆情追踪", "Opinion Tracking")}</h1>
          <p>{t("选择项目查看监测总览和账号分析。", "Select a project to view monitoring and account analysis.")}</p></div>}
        {project && view === "overview" && <div className="amp-opinion-heading-actions">
          <GuardedButton type="button" className="amp-button amp-button-secondary" disabled={!monitor || monitorLoading}
            blockedReason={t("请等待监测数据加载完成后再导出。", "Wait for monitoring data to load before exporting.")}
            onClick={exportData}>{t("导出数据", "Export data")}</GuardedButton>
          <GuardedButton type="button" className="amp-button amp-button-primary"
            disabled={!accountCount || strategyBusy || monitorLoading || !monitor}
            blockedReason={strategyBusy ? t("策略正在生成，请稍候。", "Strategy is being generated. Please wait.")
              : t("需要已连接账号和可用监测数据。", "Connected accounts and monitoring data are required.")}
            onClick={() => { void createStrategy(); }}>
            {strategyBusy ? t("生成中…", "Generating…") : t("生成策略", "Generate strategy")}
          </GuardedButton>
        </div>}
      </header>
      {loading ? <div className="amp-page-state" role="status">{t("加载中…", "Loading…")}</div>
        : error ? <div className="amp-page-state" role="alert">{error}
          <button type="button" className="amp-button amp-button-secondary" onClick={retry}>{t("重试", "Retry")}</button></div>
          : !projectId ? projects.length ? <div className="amp-projects-grid amp-opinion-project-grid">
            {projects.map((item) => <OpinionProjectCard key={item.id} project={item}
              accountCount={groupLeadTrackingEntities(accounts.filter((account) => account.project_id === item.id)).length} />)}
          </div> : <WorkspaceEmptyState icon="radar" title={t("暂无项目", "No projects")}
            description={t("创建项目并连接渠道账号后开始舆情追踪。", "Create a project and connect channel accounts to begin monitoring.")} />
            : !project ? <WorkspaceEmptyState icon="alert" title={t("项目不存在或无法访问", "Project not found or inaccessible")}
              description={<Link href="/opinion_tracking">{t("返回全部项目", "Back to all projects")}</Link>} />
              : <>
                <div className="amp-project-detail-tabs" role="tablist" aria-label={t("舆情追踪范围", "Opinion tracking scope")}>
                  <button type="button" role="tab" id="opinion-overview-tab" aria-controls="opinion-overview-panel"
                    aria-selected={view === "overview"} onClick={() => changeView("overview")}>{t("监测总览", "Monitoring overview")}</button>
                  <button type="button" role="tab" id="opinion-accounts-tab" aria-controls="opinion-accounts-panel"
                    aria-selected={view === "accounts"} onClick={() => changeView("accounts")}>{t("账号分析", "Account analysis")}</button>
                </div>
                {view === "accounts" ? <div role="tabpanel" id="opinion-accounts-panel" aria-labelledby="opinion-accounts-tab">
                  <AccountTrackingList key={`${scope}:${projectId}`} accounts={accounts} projectId={projectId} scope={scope} />
                </div> : <div role="tabpanel" id="opinion-overview-panel" aria-labelledby="opinion-overview-tab">
                  <div className="amp-insight-toolbar amp-opinion-scope">
                    <EnterpriseSelect<"7" | "30"> value={days === 30 ? "30" : "7"}
                      onChange={(value) => changeView("overview", value === "30" ? 30 : 7)}
                      options={[{ value: "7", label: t("近 7 天", "Last 7 days") }, { value: "30", label: t("近 30 天", "Last 30 days") }]}
                      ariaLabel={t("选择周期", "Select period")} className="w-36 shrink-0" />
                    <div className="amp-opinion-scope-summary">
                    <span className="amp-opinion-project-scope-note">{t("{count} 个账号", "{count} accounts", { count: accountCount })}</span>
                    <button type="button" className="amp-member-action-more amp-opinion-refresh"
                      aria-label={t("刷新监测总览", "Refresh monitoring overview")}
                      title={t("刷新监测总览", "Refresh monitoring overview")}
                      onClick={() => setAttempt((value) => value + 1)}>
                      <InlineIcon name="refresh" />
                    </button>
                    </div>
                  </div>
                  {monitor?.overview.status === "partial" && <p className="amp-opinion-coverage-note" role="status">
                    {t("部分账号或日期的数据不完整，以下为已获取数据。",
                      "Some accounts or dates have incomplete data. The overview shows available data.")}
                  </p>}
                  {!accountCount ? <WorkspaceEmptyState icon="radar" title={t("暂无渠道账号", "No channel accounts")}
                    description={t("请先在此项目中连接渠道账号。", "Connect channel accounts in this project first.")} />
                    : monitorState.key === scopeKey && monitorState.error ? <div className="amp-page-state" role="alert">{monitorState.error}
                      <button type="button" className="amp-button amp-button-secondary" onClick={() => setAttempt((value) => value + 1)}>{t("重试", "Retry")}</button></div>
                      : <>
                        <OpinionOverviewPanel data={monitor?.overview || null} performance={monitor?.details.performance || null}
                          loading={monitorLoading} error="" onRetry={() => setAttempt((value) => value + 1)} />
                        <OpinionEvidenceSections key={scopeKey} details={monitor?.details || null}
                          loading={monitorLoading} error="" onRetry={() => setAttempt((value) => value + 1)}
                          actions={monitor?.actions || null} strategy={strategy} strategyBusy={strategyBusy} strategyError={strategyError} />
                      </>}
                </div>}
              </>}
    </main>
    {!loading && project && accountId && <AccountAnalysisDialog
      key={`${scope}:${projectId}:${accountId}:${params.get("tab") || ""}:${params.get("date") || ""}`}
      projectId={projectId} accountId={accountId} accounts={accounts}
      initialTab={params.get("tab") || ""} initialDate={params.get("date") || ""}
      onClose={closeAccount} />}
  </div>;
}
