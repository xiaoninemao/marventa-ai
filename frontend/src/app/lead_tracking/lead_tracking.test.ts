import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import WorkspaceEmptyState from "../../components/redesign/WorkspaceEmptyState.tsx";
import { I18nProvider } from "../../contexts/i18n_context.tsx";
import { ToastProvider } from "../../contexts/toast_context.tsx";
import LeadTrackingEntityCard from "../../components/lead_tracking/LeadTrackingEntityCard.tsx";
import CommentInsightPanel from "../../components/lead_tracking/CommentInsightPanel.tsx";
import LeadAnalysisPanel, {
  isLeadMetricActive,
} from "../../components/lead_tracking/LeadAnalysisPanel.tsx";
import OpinionOverviewPanel from "../../components/lead_tracking/OpinionOverviewPanel.tsx";
import OpinionEvidenceSections from "../../components/lead_tracking/OpinionEvidenceSections.tsx";
import DailyReportPanel from "../../components/lead_tracking/DailyReportPanel.tsx";
import {
  filterLeadTrackingEntities,
  groupLeadTrackingEntities,
  leadTrackingEntityHref,
} from "../../utils/lead_tracking.ts";
import type { AccountContentAccount } from "../../types/account_content.ts";
import type { DailyCommentReport, OpinionOverview } from "../../types/lead_tracking.ts";

const account: AccountContentAccount = {
  id: "account-a", project_id: "project-a", project_title: "Marketing project", platform: "douyin",
  account_name: "<b>Account A</b>", platform_user_id: "same-platform-identity", profile_url: "", notes: "",
  created_by_user_id: "", creator_name: "Creator", creator_avatar_url: "", authorization_status: "active",
  token_expires_at: "", refresh_token_expires_at: "", created_at: "", updated_at: "",
  content_status: "ready", required_scope: "video.list", content_message: "",
};

test("Opinion Tracking merges both operations entries into one module", () => {
  const shell = readFileSync(new URL("../../components/layout/app_shell.tsx", import.meta.url), "utf8");
  assert.match(shell, /\{ label: "舆情追踪", labelEn: "Opinion Tracking", path: "\/opinion_tracking", icon: "radar"/);
  assert.doesNotMatch(shell, /label: "线索追踪"|label: "舆情分析"/);
  const listing = readFileSync(new URL("../module_listing.tsx", import.meta.url), "utf8");
  assert.match(listing, /label: "舆情追踪", labelEn: "Opinion Tracking", path: "\/opinion_tracking", icon: "radar"/);
  assert.doesNotMatch(listing, /label: "线索追踪"|label: "舆情分析"/);
  const opinion = readFileSync(new URL("../opinion_tracking/page.tsx", import.meta.url), "utf8");
  assert.match(opinion, /t\("舆情追踪", "Opinion Tracking"\)/);
  assert.match(opinion, /router\.replace\(`\/opinion_tracking\?\$\{query\}`\)/);
  assert.match(shell, /\[\.\.\.navItems, \.\.\.utilityNavItems\]/);
});

test("project selection defaults to all-account monitoring and account features stay contained", () => {
  const page = readFileSync(new URL("../opinion_tracking/page.tsx", import.meta.url), "utf8");
  assert.match(page, /params\.get\("view"\) === "accounts" \|\| accountId \? "accounts" : "overview"/);
  assert.match(page, /<PublishingProjectSidebar module="leadTracking"/);
  assert.match(page, /fetch_project_opinion_monitor\(projectId, days, controller\.signal\)/);
  assert.doesNotMatch(page, /fetch_opinion_overview|fetch_opinion_details|scopedAccounts\[0\]|accounts\[0\]/);
  assert.match(page, /<AccountTrackingList key=\{`\$\{scope\}:\$\{projectId\}`\}/);
  assert.match(page, /id="opinion-overview-panel"/);
  assert.match(page, /id="opinion-accounts-panel"/);
  const accountPage = readFileSync(new URL("../../components/lead_tracking/AccountAnalysisDialog.tsx", import.meta.url), "utf8");
  assert.match(page, /<AccountAnalysisDialog/);
  assert.match(page, /query\.set\("view", "accounts"\)/);
  assert.match(accountPage, /fetch_lead_tracking_analysis\(projectId, accountId/);
  assert.match(accountPage, /fetch_daily_comment_report\(projectId, accountId/);
});

test("legacy list/account/report links redirect without losing scope or selected report", () => {
  const list = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");
  const detail = readFileSync(new URL("./[accountId]/page.tsx", import.meta.url), "utf8");
  assert.match(list, /query\.set\("project", params\.project\)/);
  assert.match(list, /redirect\(`\/opinion_tracking/);
  assert.match(detail, /\["project", "tab", "date"\]/);
  assert.match(detail, /redirect\(`\/opinion_tracking\/accounts\/\$\{encodeURIComponent\(accountId\)\}/);
  const legacyOpinion = readFileSync(new URL("./opinion/page.tsx", import.meta.url), "utf8");
  assert.match(legacyOpinion, /\["project", "days"\]/);
  assert.doesNotMatch(legacyOpinion, /"account"/);
  const accountRedirect = readFileSync(new URL("../opinion_tracking/accounts/[accountId]/page.tsx", import.meta.url), "utf8");
  assert.match(accountRedirect, /new URLSearchParams\(\{ view: "accounts" \}\)/);
  assert.match(accountRedirect, /\["project", "days", "tab", "date"\]/);
  assert.match(accountRedirect, /query\.set\("account", accountId\)/);
  assert.match(accountRedirect, /redirect\(`\/opinion_tracking\?\$\{query\}`\)/);
});

test("account analysis uses a native guarded modal over the existing account list", () => {
  const dialog = readFileSync(new URL("../../components/lead_tracking/AccountAnalysisDialog.tsx", import.meta.url), "utf8");
  const parent = readFileSync(new URL("../opinion_tracking/page.tsx", import.meta.url), "utf8");
  assert.match(dialog, /<dialog ref=\{dialog\} aria-labelledby=\{titleId\}/);
  assert.match(dialog, /element\.showModal\(\)/);
  assert.match(dialog, /element\?\.open\) element\.close\(\)/);
  assert.match(dialog, /onCancel=\{\(event\) => \{ event\.preventDefault\(\); close\(\); \}\}/);
  assert.match(dialog, /event\.key === "Escape"/);
  assert.match(dialog, /event\.target !== event\.currentTarget/);
  assert.match(dialog, /if \(busy\)/);
  assert.match(dialog, /disabled=\{busy\}/);
  assert.match(dialog, /controller\.abort\(\)/);
  assert.doesNotMatch(dialog, /actionsContainer|setReportActionsContainer|downloadReport|reviewComment/);
  assert.doesNotMatch(dialog, /<main|<PublishingProjectSidebar|useLeadTrackingEntities|useParams/);
  assert.match(parent, /\["account", "tab", "date"\]/);
  assert.match(parent, /router\.replace\(`\/opinion_tracking\?\$\{query\}`, \{ scroll: false \}\)/);
  const css = readFileSync(new URL("../../styles/projects.css", import.meta.url), "utf8");
  assert.match(css, /\.amp-account-analysis-dialog\[open\] \{ display: flex; flex-direction: column;/);
  assert.match(css, /\.amp-account-analysis-body \{[^}]*overflow-y: auto/);
  assert.doesNotMatch(css, /amp-account-analysis-actions|amp-daily-report-toolbar/);
  assert.match(css, /\.amp-redesign \.amp-account-analysis-body \.amp-lead-comment-summary \{ margin: 0 0 14px; \}/);
  assert.match(css, /\.amp-redesign \.amp-account-analysis-body \.amp-lead-analysis \{ padding-top: 0; \}/);
});

test("the lead list uses real project-account entities, scoped state and shared pagination", () => {
  const page = readFileSync(new URL("../../components/lead_tracking/AccountTrackingList.tsx", import.meta.url), "utf8");
  const hook = readFileSync(new URL("../../components/lead_tracking/useLeadTrackingEntities.ts", import.meta.url), "utf8");
  assert.match(page, /<LeadTrackingEntityCard/);
  assert.match(page, /<Pagination/);
  assert.match(page, /className="amp-opinion-account-list"/);
  assert.match(page, /<WorkspaceEmptyState icon="user" title=\{t\("暂无渠道账号", "No channel accounts"\)\}/);
  assert.doesNotMatch(page, /amp-opinion-account-description|Select an account to view/);
  const css = readFileSync(new URL("../../styles/projects.css", import.meta.url), "utf8");
  assert.match(css, /\.amp-opinion-workspace > #opinion-accounts-panel \{[^}]*flex: 1/);
  assert.match(css, /\.amp-redesign \.amp-opinion-account-list > \.amp-pagination \{ margin-top: auto; padding-top: 20px;/);
  assert.match(page, /<div className="amp-insight-toolbar">/);
  assert.match(page, /ariaLabel=\{t\("账号渠道", "Account channel"\)\} className="w-36"/);
  assert.doesNotMatch(page, /amp-lead-tracking-toolbar|amp-lead-tracking-channel/);
  assert.match(page, /accounts\.filter\(\(account\) => account\.project_id === projectId\)/);
  assert.match(page, /usePagination\(filtered, `\$\{scope\}:\$\{projectId\}:\$\{query\}:\$\{platform\}`\)/);
  assert.match(hook, /fetch_account_content_accounts\("", controller\.signal\)/);
  assert.match(hook, /state\.scope === scope/);
  assert.match(hook, /controller\.abort\(\)/);
  assert.doesNotMatch(page, /fetch_leads|mock|lead_count/i);
});

test("lead workspace shows account-wide data without a work selector or work-list request", () => {
  const page = readFileSync(new URL("../../components/lead_tracking/AccountAnalysisDialog.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(page, /amp-lead-work-context|lead-work-select|fetch_lead_tracking_works|workState|workAttempt|setSelectedWorkId/);
  assert.match(page, /fetch_lead_tracking_comment_insight\(projectId, accountId, "", controller\.signal\)/);
  assert.doesNotMatch(page, /download_daily_comment_report|review_daily_report_comment/);
  const css = readFileSync(new URL("../../styles/projects.css", import.meta.url), "utf8");
  assert.doesNotMatch(css, /amp-lead-work-context/);
});

test("opinion selectors reuse standard controls and report no longer renders selectors", () => {
  const opinion = readFileSync(new URL("../opinion_tracking/page.tsx", import.meta.url), "utf8");
  const report = readFileSync(new URL("../../components/lead_tracking/DailyReportPanel.tsx", import.meta.url), "utf8");
  assert.equal((opinion.match(/<EnterpriseSelect/g) || []).length, 1);
  assert.equal((report.match(/<EnterpriseSelect/g) || []).length, 0);
  assert.doesNotMatch(opinion + report, /<select\b|<GuardedSelect\b|<option\b/);
  assert.match(opinion, /value === "30" \? 30 : 7/);
  assert.doesNotMatch(report, /选择日报日期|刷新简报|amp-daily-report-date-control/);
  assert.ok(opinion.includes("选择周期"));
  assert.match(opinion, /module="leadTracking"/);
  assert.doesNotMatch(report, /选择评论观点|核心评论|Featured comments|Product comments|Export report/);
  const css = readFileSync(new URL("../../styles/projects.css", import.meta.url), "utf8");
  assert.doesNotMatch(css, /\.amp-(?:opinion-scope|daily-report-toolbar|daily-report-review) select/);
  assert.doesNotMatch(css, /amp-daily-report-review/);
  assert.match(opinion, /ariaLabel=\{t\("选择周期", "Select period"\)\} className="w-36 shrink-0"/);
  assert.match(css, /\.amp-redesign \.amp-insight-toolbar\.amp-opinion-scope \{[^}]*font-family: inherit;[^}]*font-size: 14px;[^}]*line-height: 20px/);
  assert.match(css, /\.amp-redesign \.amp-opinion-project-scope-note \{[^}]*font-size: 14px;[^}]*font-weight: 400;[^}]*line-height: 20px;[^}]*white-space: nowrap/);
  assert.match(css, /\.amp-opinion-scope-summary \{[^}]*margin-left: auto/);
  assert.match(css, /\.amp-redesign \.amp-insight-toolbar\.amp-opinion-scope \{[^}]*margin: 16px 0/);
  assert.match(css, /\.amp-redesign \.amp-opinion-account-list > \.amp-insight-toolbar \{ margin: 16px 0; \}/);
  assert.doesNotMatch(css, /\.amp-opinion-workspace \.amp-opinion-dashboard \{[^}]*margin-top:/);
  assert.match(opinion, /className="amp-opinion-scope-summary"/);
  assert.doesNotMatch(opinion, /项目全部账号 ·/);
  assert.doesNotMatch(css, /\.amp-opinion-(?:scope-field|period-select|account-select|project-select)/);
});

test("opinion workspace uses shared module styling without decorative prototype chrome", () => {
  const page = readFileSync(new URL("../opinion_tracking/page.tsx", import.meta.url), "utf8");
  const overview = readFileSync(new URL("../../components/lead_tracking/OpinionOverviewPanel.tsx", import.meta.url), "utf8");
  const evidence = readFileSync(new URL("../../components/lead_tracking/OpinionEvidenceSections.tsx", import.meta.url), "utf8");
  assert.match(page, /"amp-projects-header"/);
  assert.match(page, /amp-project-detail-header amp-project-header-aligned/);
  assert.match(page, /<h1 title=\{project\.title\}>\{project\.title/);
  assert.match(page, /href="\/opinion_tracking" className="amp-project-detail-back"/);
  const projectPage = readFileSync(new URL("../projects/[projectId]/page.tsx", import.meta.url), "utf8");
  assert.match(projectPage, /className="amp-project-detail-header amp-project-header-aligned"/);
  assert.match(page, /className="amp-module-title"/);
  assert.match(page, /className="amp-insight-toolbar amp-opinion-scope"/);
  assert.match(page, /<GuardedButton[^]*className="amp-button amp-button-primary"/);
  assert.doesNotMatch(page, /amp-opinion-breadcrumb|amp-opinion-heading-symbol/);
  assert.match(evidence, /<div className="amp-projects-search">\s*<RedesignInput leftIcon=\{<InlineIcon name="search" className="h-4 w-4"/);
  assert.match(evidence, /<EnterpriseSelect<"all" \| "positive" \| "neutral" \| "negative">/);
  const commentsToolbar = evidence.split('<div className="amp-opinion-comments-toolbar">')[1]?.split('<div className="amp-opinion-voice-list">')[0];
  assert.ok(commentsToolbar);
  assert.ok(commentsToolbar.indexOf('className="amp-projects-search"') < commentsToolbar.indexOf("<EnterpriseSelect"));
  assert.match(overview, /<WorkspaceEmptyState/);
  assert.match(evidence, /className="amp-opinion-inline-empty"/);
  assert.doesNotMatch(evidence, /MARVENTA \/ MONITOR|tone-\$\{|Analyze →|Copy advice ↗/);
  const css = readFileSync(new URL("../../styles/projects.css", import.meta.url), "utf8");
  assert.match(css, /\.amp-opinion-comments-toolbar \{[^}]*flex-wrap: nowrap/);
  assert.match(css, /\.amp-opinion-comments-toolbar > \.amp-enterprise-select \{[^}]*margin-left: auto/);
  assert.match(css, /\.amp-opinion-comments-toolbar > \.amp-enterprise-select \{ flex: 0 0 176px; width: 176px;/);
  assert.match(css, /\.amp-opinion-comments-toolbar \.amp-enterprise-select-trigger > span \{[^}]*white-space: nowrap/);
  assert.match(css, /\.amp-redesign \.amp-project-detail-main \{[^}]*padding: 28px 26px 40px/);
  assert.match(css, /\.amp-redesign \.amp-project-header-aligned \{[^}]*align-items: flex-start;[^}]*min-height: 38px/);
  assert.match(css, /\.amp-redesign \.amp-project-detail-title h1 \{[^}]*line-height: 38px/);
  assert.doesNotMatch(css, /amp-opinion-heading-symbol|amp-opinion-searchfield|amp-opinion-generate/);
  assert.match(css, /\.amp-opinion-post-table th \{[^}]*font-size: 13px/);
  assert.match(css, /\.amp-opinion-voices-card, \.amp-opinion-strategy-card \{[^}]*border: 1px solid #e4e7ec[^}]*border-radius: 12px/);
});

test("lead workspace runs scoped analysis and retains strict entity context", () => {
  const page = readFileSync(new URL("../../components/lead_tracking/AccountAnalysisDialog.tsx", import.meta.url), "utf8");
  assert.match(page, /item\.id === accountId && item\.project_id === projectId/);
  assert.match(page, /groupLeadTrackingEntities\(accounts\)/);
  assert.match(page, /const projectName = account\?\.project_title \|\| ""/);
  assert.match(page, /\{account && <p>\{projectName\}<\/p>\}/);
  assert.doesNotMatch(page, /bindings\.map\(\(binding\) => binding\.project_title\)|account\.platform ===/);
  assert.match(page, /\{!account \? <div className="amp-projects-state" role="alert">/);
  assert.match(page, /useState<"comments" \| "analysis" \| "report">/);
  assert.doesNotMatch(page, /LeadTrackingSectionNav|舆情监测/);
  assert.doesNotMatch(page, /id="lead-opinion-tab"/);
  assert.match(page, /<DailyReportPanel/);
  assert.match(page, /评论洞察/);
  assert.match(page, /意向评估/);
  assert.doesNotMatch(page, /每日评论洞察|每天 00:00 汇总|Daily comment insights|At 00:00 each day/);
  assert.match(page, /<CommentInsightPanel/);
  const panel = readFileSync(new URL("../../components/lead_tracking/CommentInsightPanel.tsx", import.meta.url), "utf8");
  assert.match(panel, /Sync is disabled, permission is missing, or the first daily snapshot has not completed/);
  assert.doesNotMatch(page, /基于评论内容识别潜在需求与跟进机会|analysis results require human review/);
  assert.match(page, /run_lead_tracking_analysis\(projectId, accountId, analysisDate\)/);
  assert.match(page, /disabled=\{!canAnalyze \|\| analyzing\}/);
  assert.match(page, /analysisData\?\.status === "failed"/);
  assert.match(page, /t\("重新分析", "Reanalyze"\)/);
  assert.match(page, /review_lead_tracking_item\(projectId, accountId, commentId, status, analysisDate\)/);
  assert.doesNotMatch(page, /查看账号内容|管理账号|View account content|Manage account/);
  assert.doesNotMatch(panel, /actions|amp-lead-tracking-workspace-links/);
  assert.doesNotMatch(page, /mock|0 leads|fetch_leads/i);
});

test("account opinion overview stays aggregate and does not expose model details or comments", () => {
  const data: OpinionOverview = {
    status: "completed", period_days: 7, start_date: "2026-10-05", end_date: "2026-10-11",
    timezone: "Asia/Shanghai", is_simulated: false, covered_days: 6, incomplete_days: 0,
    comments_collected: 20, distinct_users: 17, last_synced_at: "2026-10-12T00:00:00Z",
    daily: [{ date: "2026-10-11", comments: 20, negative_percent: 15 }],
    question_percent: 30, demand_percent: 25,
    sentiments: [{ key: "negative", label: "负向", count: 3, percent: 15 }],
    themes: [{ key: "1", label: "报表 · 数据", count: 8, percent: 40 }],
    words: [{ word: "报表", weight: 0.8 }],
    keyword_clusters: [{ key: "1", label: "报表与数据", count: 8, percent: 40, keywords: ["报表", "导出"] }],
    theme_status: "ready",
  };
  const html = renderToStaticMarkup(createElement(I18nProvider, null, createElement(ToastProvider, null,
    createElement(OpinionOverviewPanel, {
      data,
      performance: { post_count: 2, views: 22500, engagement: 1450, risk_count: 3,
        daily: Array.from({ length: 7 }, (_, index) => ({
          date: `2026-10-${String(index + 5).padStart(2, "0")}`, views: 500 + index * 80,
          engagement: 100 + index * 20, previous_views: 300 + index * 40,
          previous_engagement: 60 + index * 10,
        })) },
      loading: false, error: "", onRetry: () => {},
    }))));
  assert.match(html, /Promotion performance trend/);
  assert.match(html, /Promotion posts/);
  assert.match(html, /Total exposure/);
  assert.match(html, /Content engagement/);
  assert.match(html, /Risks to review/);
  assert.match(html, /Previous period/);
  assert.match(html, /Audience topics/);
  assert.match(html, /Comment sentiment/);
  assert.match(html, /8 comments/);
  assert.match(html, /Copy summary/);
  assert.match(html, /amp-opinion-sentiment-legend/);
  const emptyHtml = renderToStaticMarkup(createElement(I18nProvider, null, createElement(ToastProvider, null,
    createElement(OpinionOverviewPanel, {
      data: { ...data, comments_collected: 0, sentiments: [] },
      performance: null, loading: false, error: "", onRetry: () => {},
    }))));
  assert.match(emptyHtml, /amp-opinion-donut/);
  assert.doesNotMatch(emptyHtml, /amp-opinion-sentiment-legend/);
  assert.doesNotMatch(emptyHtml, /amp-opinion-trend-legend/);
  assert.match(emptyHtml, /amp-opinion-trend-card/);
  assert.doesNotMatch(html, /BERTopic|LDA|停用词|原始评论/);
  const previousNodeEnv = process.env.NODE_ENV;
  try {
    Object.assign(process.env, { NODE_ENV: "production" });
    const productionHtml = renderToStaticMarkup(createElement(I18nProvider, null, createElement(ToastProvider, null,
      createElement(OpinionOverviewPanel, {
        data: { ...data, is_simulated: true }, performance: null, loading: false, error: "", onRetry: () => {},
      }))));
    assert.doesNotMatch(productionHtml, /Local simulated data|本地模拟数据/);
    Object.assign(process.env, { NODE_ENV: "development" });
    const previewHtml = renderToStaticMarkup(createElement(I18nProvider, null, createElement(ToastProvider, null,
      createElement(OpinionOverviewPanel, {
        data: { ...data, is_simulated: true }, performance: null, loading: false, error: "", onRetry: () => {},
      }))));
    assert.match(previewHtml, /Local simulated data/);
  } finally {
    Object.assign(process.env, { NODE_ENV: previousNodeEnv });
  }
});

test("daily report hides date/refresh controls and keeps distinct centered empty and error states", () => {
  const props = {
    report: null, loading: false, error: "", onRetry: () => {},
  };
  const render = (overrides = {}) => renderToStaticMarkup(createElement(I18nProvider, null,
    createElement(ToastProvider, null, createElement(DailyReportPanel, { ...props, ...overrides }))));
  const empty = render();
  assert.doesNotMatch(empty, /amp-daily-report-toolbar|Select report date|Refresh report/);
  assert.match(empty, /No daily report/);
  assert.doesNotMatch(empty, /No verified comment report available|No verified daily report is available|amp-daily-report-empty/);
  assert.doesNotMatch(empty, /<span>Report date<\/span>/);
  const error = render({ error: "Report request failed" });
  assert.match(error, /role="alert"/);
  assert.match(error, /Report request failed/);
  assert.match(error, /Retry/);
  assert.doesNotMatch(error, /No daily report/);
  const loading = render({ loading: true });
  assert.match(loading, /Loading daily report/);
  assert.doesNotMatch(loading, /No daily report/);
  const source = readFileSync(new URL("../../components/lead_tracking/DailyReportPanel.tsx", import.meta.url), "utf8");
  const accountPage = readFileSync(new URL("../../components/lead_tracking/AccountAnalysisDialog.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(accountPage, /fetch_daily_report_dates|setReportDates/);
  assert.match(source, /report\?\.status === "failed"/);
  assert.match(source, /error \|\| report\?\.message/);
});

test("completed daily reports retain feedback evidence without export or featured comments", () => {
  const report: DailyCommentReport = {
    status: "completed", date: "2026-10-14", timezone: "Asia/Shanghai", organization_id: "org",
    account_key: "account", platform: "douyin", source: "official_douyin_api", is_simulated: false,
    collection_complete: true, comments_collected: 1, distinct_users: 1, works_with_comments: 1,
    purchase_intent_comments: 0, feature_request_comments: 1, negative_feedback_comments: 0,
    negated_comments: 0, pending_review_comments: 0, top_comments: [],
    semantic_status: "rules_only", model_version: "", llm_used: false, message: "", generated_at: "",
    topics: [{
      topic: "Reports", conclusion: "Improve export", supporting_comments: 1, opposing_comments: 0,
      neutral_comments: 0, distinct_users: 1, works: 1, evidence_level: "needs_validation",
      trend: "insufficient_history", evidence_comment_ids: ["comment"], quotes: ["Please improve export"],
      product_suggestion: "Review export speed", marketing_suggestion: "Publish export guidance", decision: "pending",
    }],
  };
  const html = renderToStaticMarkup(createElement(I18nProvider, null,
    createElement(DailyReportPanel, { report, loading: false, error: "", onRetry: () => {} })));
  assert.match(html, /Feedback analysis|Review export speed|Publish export guidance/);
  assert.match(html, /View source comments|Please improve export/);
  assert.doesNotMatch(html, /daily-report-work-comments|Product comments|Export report|Featured comments|Confirm judgment|amp-daily-report-toolbar/);
});

test("opinion card empty states use short single-line hints without page-level illustrations", () => {
  const html = renderToStaticMarkup(createElement(I18nProvider, null,
    createElement(ToastProvider, null, createElement(OpinionEvidenceSections, {
      details: null, loading: false, error: "", onRetry: () => {}, actions: null,
      strategy: null, strategyBusy: false, strategyError: "",
    }))));
  assert.equal((html.match(/class="amp-opinion-inline-empty"/g) || []).length, 3);
  assert.match(html, /No promotion content/);
  assert.match(html, /No comments/);
  assert.match(html, /No strategy yet/);
  assert.doesNotMatch(html, /amp-projects-empty-icon|amp-projects-state|Available promotion posts|Use available feedback/);
  const overview = readFileSync(new URL("../../components/lead_tracking/OpinionOverviewPanel.tsx", import.meta.url), "utf8");
  assert.equal((overview.match(/className="amp-opinion-inline-empty"/g) || []).length, 2);
  const css = readFileSync(new URL("../../styles/projects.css", import.meta.url), "utf8");
  assert.match(css, /\.amp-opinion-inline-empty \{[^}]*min-height: 80px;[^}]*font-size: 14px;[^}]*font-weight: 400;[^}]*line-height: 20px/);
  assert.match(css, /--amp-opinion-panel-min-height: 306px/);
  assert.match(css, /\.amp-opinion-display-card \{[^}]*min-height: var\(--amp-opinion-panel-min-height\)/);
  assert.match(css, /\.amp-opinion-voices-card, \.amp-opinion-strategy-card \{[^}]*min-height: var\(--amp-opinion-panel-min-height\)/);
  assert.match(css, /\.amp-opinion-post-table:has\(\.amp-opinion-inline-empty\) \{ height: calc\(var\(--amp-opinion-panel-min-height\) - 2px\)/);
  assert.match(css, /\.amp-opinion-post-table tbody tr:hover td:not\(\[colspan\]\) \{ background: #fbfcff; \}/);
  assert.doesNotMatch(css, /\.amp-opinion-post-table tr:hover td\s*\{/);
  assert.match(css, /\.amp-opinion-workspace > #opinion-overview-panel \{[^}]*display: flex;[^}]*flex: 1;[^}]*flex-direction: column/);
  assert.match(css, /\.amp-opinion-workspace > #opinion-overview-panel > \.amp-projects-state \{ flex: 1; min-height: 240px;/);
});

test("lead analysis reuses the standard workspace empty state and decorative target icon", () => {
  const html = renderToStaticMarkup(createElement(WorkspaceEmptyState, {
    icon: "target", title: "Lead sources are not connected", description: "No source has been connected.",
  }));
  assert.match(html, /class="amp-projects-state"/);
  assert.match(html, /class="amp-projects-empty-icon"/);
  assert.match(html, /<circle cx="12" cy="12" r="9"/);
  assert.match(html, /aria-hidden="true"/);
  assert.doesNotMatch(html, /<button|<input|0 leads/);
});

test("lead analysis renders explainable B2B results and manual review actions", () => {
  const html = renderToStaticMarkup(createElement(I18nProvider, null,
    createElement(ToastProvider, null, createElement(LeadAnalysisPanel, {
      data: {
        status: "completed", date: "2026-10-05", timezone: "Asia/Shanghai",
        analysis_method: "ai", model: "qwen3.8-flash",
        rule_version: "lead-qualification-ai-v1", is_simulated: true,
        analyzed_count: 1, high_count: 1, medium_count: 0, low_count: 0,
        pending_count: 1, generated_at: "2026-10-06T00:00:10Z", message: "",
        items: [{
          comment_id: "lead-1", comment_user_id: "<buyer>", content: "<script>Need pricing</script>",
          create_time: 1791158400, item_id: "item-1", score: 92, intent: "high",
          demand_labels: ["pricing"], evidence: ["purchase_intent", "direct_question"],
          recommended_action: "send_pricing", review_status: "pending", reviewed_at: "",
        }],
      },
      loading: false, error: "", onRetry: () => {}, onReview: () => {}, reviewingCommentId: "",
    })),
  ));
  assert.match(html, /Intent evaluation summary/);
  assert.match(html, /AI model qwen3.8-flash/);
  assert.match(html, /High intent/);
  assert.match(html, /Pricing &amp; purchase/);
  assert.match(html, /Purchase intent/);
  assert.match(html, /Send pricing/);
  assert.match(html, /Confirm/);
  assert.match(html, /Dismiss/);
  assert.match(html, /aria-label="Intent level"[^>]+aria-haspopup="listbox"/);
  assert.match(html, /aria-label="Review status"[^>]+aria-haspopup="listbox"/);
  assert.doesNotMatch(html, /<select|<option/);
  assert.match(html, /&lt;script&gt;Need pricing&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script>Need pricing|phone|wechat/i);
});

test("lead analysis metric highlight follows intent and review selectors", () => {
  assert.equal(isLeadMetricActive("high", "high", "all"), true);
  assert.equal(isLeadMetricActive("high", "all", "all"), false);
  assert.equal(isLeadMetricActive("pending", "all", "pending"), true);
  assert.equal(isLeadMetricActive("high", "high", "confirmed"), true);
  assert.equal(isLeadMetricActive("pending", "high", "confirmed"), false);
  assert.equal(isLeadMetricActive("confirmed", "all", "confirmed"), true);
  assert.equal(isLeadMetricActive("confirmed", "all", "dismissed"), false);
});

test("failed analysis is explicit while unavailable analysis waits for daily sync", () => {
  const failed = renderToStaticMarkup(createElement(I18nProvider, null,
    createElement(LeadAnalysisPanel, {
      data: {
        status: "failed", date: "2026-10-05", timezone: "Asia/Shanghai",
        analysis_method: "ai", model: "qwen3.8-flash",
        rule_version: "lead-qualification-ai-v1", is_simulated: false, items: [],
        analyzed_count: 0, high_count: 0, medium_count: 0, low_count: 0,
        pending_count: 0, generated_at: "2026-10-06T00:00:10Z",
        message: "Lead analysis failed; retry is available",
      },
      loading: false, error: "", onRetry: () => {}, onReview: () => {}, reviewingCommentId: "",
    }),
  ));
  assert.match(failed, /Intent evaluation failed/);
  assert.match(failed, /Select Reanalyze to try again/);
  const unavailable = renderToStaticMarkup(createElement(I18nProvider, null,
    createElement(LeadAnalysisPanel, {
      data: {
        status: "unavailable", date: "2026-10-05", timezone: "Asia/Shanghai",
        analysis_method: "ai", model: "qwen3.8-flash",
        rule_version: "", is_simulated: false, items: [], analyzed_count: 0,
        high_count: 0, medium_count: 0, low_count: 0, pending_count: 0,
        generated_at: "", message: "",
      },
      loading: false, error: "", onRetry: () => {}, onReview: () => {}, reviewingCommentId: "",
    }),
  ));
  assert.match(unavailable, /generated automatically after the next daily comment sync/);
  assert.doesNotMatch(unavailable, /Select Analyze/);
});

test("entity cards expose one channel account with all project bindings", () => {
  const merged = groupLeadTrackingEntities([
    account,
    { ...account, id: "account-b", project_id: "project-b", project_title: "Other project" },
  ])[0];
  const html = renderToStaticMarkup(createElement(I18nProvider, null,
    createElement(LeadTrackingEntityCard, { entity: merged, selectedProjectId: "project-b" }),
  ));
  assert.match(html, /href="\/opinion_tracking\?project=project-b&amp;view=accounts&amp;account=account-b"/);
  assert.match(html, /&lt;b&gt;Account A&lt;\/b&gt;/);
  assert.match(html, /Marketing project/);
  assert.match(html, /Douyin/);
  assert.match(html, /%2Fimages%2Fchannels%2Fdouyin\.jpg/);
  assert.match(html, /Douyin<span aria-hidden="true">·<\/span><span class="amp-lead-tracking-projects">Marketing project、Other project<\/span>/);
  assert.doesNotMatch(html, /Comments not connected|Creator|<svg|<dt>|<dd>/);
});

test("each supported channel uses its own platform icon", () => {
  const xhsEntity = groupLeadTrackingEntities([{ ...account, platform: "xiaohongshu" }])[0];
  const xhs = renderToStaticMarkup(createElement(I18nProvider, null,
    createElement(LeadTrackingEntityCard, { entity: xhsEntity }),
  ));
  assert.match(xhs, /%2Fimages%2Fchannels%2Fxiaohongshu\.jpg/);
  assert.match(xhs, /Xiaohongshu/);
  assert.doesNotMatch(xhs, /douyin\.jpg/);
  assert.doesNotMatch(xhs, /<b>Account A|0 leads/);
});

test("same platform identity merges projects while filters preserve project scope", () => {
  const other: AccountContentAccount = { ...account, id: "account-b", project_id: "project-b", project_title: "Other project" };
  const xhs: AccountContentAccount = { ...account, id: "account-c", platform: "xiaohongshu", account_name: "XHS", project_title: "Brand" };
  const entities = groupLeadTrackingEntities([account, other, xhs]);
  assert.equal(entities.length, 2);
  const douyin = entities.find((item) => item.platform === "douyin");
  assert.ok(douyin);
  assert.deepEqual(douyin.bindings.map((item) => item.project_id), ["project-a", "project-b"]);
  assert.deepEqual(filterLeadTrackingEntities(entities, "", "douyin").map((item) => item.key), [douyin.key]);
  assert.deepEqual(filterLeadTrackingEntities(entities, "other", "all").map((item) => item.key), [douyin.key]);
  assert.deepEqual(filterLeadTrackingEntities(entities, "小红书", "all").map((item) => item.platform), ["xiaohongshu"]);
  assert.deepEqual(filterLeadTrackingEntities(entities, "", "all", "project-b").map((item) => item.key), [douyin.key]);
  assert.equal(leadTrackingEntityHref(douyin), "/opinion_tracking?project=project-a&view=accounts&account=account-a");
  assert.equal(leadTrackingEntityHref(douyin, "project-b"), "/opinion_tracking?project=project-b&view=accounts&account=account-b");
  const escaped = groupLeadTrackingEntities([{ ...account, id: "a/b", project_id: "p&x" }])[0];
  assert.equal(leadTrackingEntityHref(escaped), "/opinion_tracking?project=p%26x&view=accounts&account=a%2Fb");
});

test("project sidebar preserves existing defaults and isolates Lead Tracking collapse state", () => {
  const sidebar = readFileSync(new URL("../../components/publishing/PublishingProjectSidebar.tsx", import.meta.url), "utf8");
  assert.match(sidebar, /module = accountContent \? "accountContent" : "publishing"/);
  assert.match(sidebar, /path: "\/opinion_tracking", storage: "amp-lead-tracking-sidebar-collapsed"/);
  assert.match(sidebar, /const STORAGE_KEY = "amp-publishing-sidebar-collapsed"/);
  assert.match(sidebar, /"amp-account-content-sidebar-collapsed"/);
});

test("daily comment insights render deterministic rank, comment data and engagement metrics", () => {
  const html = renderToStaticMarkup(createElement(I18nProvider, null,
    createElement(CommentInsightPanel, {
      data: {
        status: "completed", date: "2026-10-04", timezone: "Asia/Shanghai", top_limit: 50,
        is_simulated: true, limited: false, message: "", last_synced_at: "2026-10-05T00:00:10Z",
        items: [{
          comment_id: "comment-1", comment_user_id: "<user>", content: "<script>Need pricing</script>",
          create_time: 1791158400, digg_count: 12, reply_comment_total: 3, top: false,
          item_id: "item-1", interaction_score: 18,
        }],
      },
      loading: false, error: "", onRetry: () => {},
    }),
  ));
  assert.match(html, /aria-label="Top 50 high-engagement comments"/);
  assert.match(html, /<span class="amp-lead-comment-rank">1<\/span>/);
  assert.match(html, /&lt;script&gt;Need pricing&lt;\/script&gt;/);
  assert.match(html, /Commenter &lt;user&gt;/);
  assert.match(html, /<dd>12<\/dd>/);
  assert.match(html, /<dd>3<\/dd>/);
  assert.doesNotMatch(html, /<script>Need pricing/);
});

test("partial, unavailable and failed comment insight states remain explicit", () => {
  const unavailable = renderToStaticMarkup(createElement(I18nProvider, null,
    createElement(CommentInsightPanel, { data: null, loading: false, error: "", onRetry: () => {} }),
  ));
  assert.match(unavailable, /No comment snapshot/);
  const failed = renderToStaticMarkup(createElement(I18nProvider, null,
    createElement(CommentInsightPanel, {
      data: { status: "failed", date: "2026-10-04", timezone: "Asia/Shanghai", top_limit: 50,
        items: [], is_simulated: false, limited: false, message: "", last_synced_at: "" },
      loading: false, error: "", onRetry: () => {},
    }),
  ));
  assert.match(failed, /role="alert"/);
  assert.match(failed, /Comment sync failed/);
});
