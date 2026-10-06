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
import {
  filterLeadTrackingEntities,
  groupLeadTrackingEntities,
  leadTrackingEntityHref,
} from "../../utils/lead_tracking.ts";
import type { AccountContentAccount } from "../../types/account_content.ts";

const account: AccountContentAccount = {
  id: "account-a", project_id: "project-a", project_title: "Marketing project", platform: "douyin",
  account_name: "<b>Account A</b>", platform_user_id: "same-platform-identity", profile_url: "", notes: "",
  created_by_user_id: "", creator_name: "Creator", creator_avatar_url: "", authorization_status: "active",
  token_expires_at: "", refresh_token_expires_at: "", created_at: "", updated_at: "",
  content_status: "ready", required_scope: "video.list", content_message: "",
};

test("Lead Tracking follows Account Content in primary navigation and shares quick-search discovery", () => {
  const shell = readFileSync(new URL("../../components/layout/app_shell.tsx", import.meta.url), "utf8");
  assert.match(shell, /path: "\/account_content"[^\n]*\n\s*\{ label: "线索追踪", labelEn: "Lead Tracking", path: "\/lead_tracking", icon: "target"/);
  assert.match(shell, /\[\.\.\.navItems, \.\.\.utilityNavItems\]/);
});

test("the lead list uses real project-account entities, scoped state and shared pagination", () => {
  const page = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");
  const hook = readFileSync(new URL("../../components/lead_tracking/useLeadTrackingEntities.ts", import.meta.url), "utf8");
  assert.match(page, /if \(!authLoading && !user\) router\.replace\("\/"\)/);
  assert.match(page, /module="leadTracking"/);
  assert.match(page, /<LeadTrackingEntityCard/);
  assert.match(page, /<Pagination/);
  assert.match(page, /<div className="amp-insight-toolbar">/);
  assert.match(page, /ariaLabel=\{t\("线索渠道", "Lead channel"\)\} className="w-36"/);
  assert.doesNotMatch(page, /amp-lead-tracking-toolbar|amp-lead-tracking-channel/);
  assert.match(page, /groupLeadTrackingEntities\(accounts\)/);
  assert.match(page, /usePagination\(filtered, `\$\{scope\}:\$\{projectId\}:\$\{query\}:\$\{platform\}`\)/);
  assert.match(hook, /fetch_account_content_accounts\("", controller\.signal\)/);
  assert.match(hook, /state\.scope === scope/);
  assert.match(hook, /controller\.abort\(\)/);
  assert.doesNotMatch(page, /fetch_leads|mock|lead_count/i);
});

test("lead workspace runs scoped analysis and retains strict entity context", () => {
  const page = readFileSync(new URL("./[accountId]/page.tsx", import.meta.url), "utf8");
  assert.match(page, /item\.id === accountId && item\.project_id === projectId/);
  assert.match(page, /groupLeadTrackingEntities\(accounts\)/);
  assert.match(page, /projectNames/);
  assert.match(page, /if \(!projectId \|\| error \|\| !account\)/);
  assert.match(page, /useState<"comments" \| "analysis">\("comments"\)/);
  assert.match(page, /评论洞察/);
  assert.match(page, /线索分析/);
  assert.doesNotMatch(page, /每日评论洞察|每天 00:00 汇总|Daily comment insights|At 00:00 each day/);
  assert.match(page, /<CommentInsightPanel/);
  const panel = readFileSync(new URL("../../components/lead_tracking/CommentInsightPanel.tsx", import.meta.url), "utf8");
  assert.match(panel, /Sync is disabled, permission is missing, or the first daily snapshot has not completed/);
  assert.doesNotMatch(page, /基于评论内容识别潜在需求与跟进机会|analysis results require human review/);
  assert.match(page, /run_lead_tracking_analysis\(projectId, accountId\)/);
  assert.match(page, /disabled=\{!canAnalyze \|\| analyzing\}/);
  assert.match(page, /analysisData\?\.status === "failed"/);
  assert.match(page, /t\("重新分析", "Reanalyze"\)/);
  assert.match(page, /review_lead_tracking_item\(projectId, accountId, commentId, status\)/);
  assert.doesNotMatch(page, /查看账号内容|管理账号|View account content|Manage account/);
  assert.doesNotMatch(panel, /actions|amp-lead-tracking-workspace-links/);
  assert.doesNotMatch(page, /mock|0 leads|fetch_leads/i);
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
  assert.match(html, /Lead analysis summary/);
  assert.match(html, /Demo data/);
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
  assert.match(failed, /Lead analysis failed/);
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
  assert.match(html, /href="\/lead_tracking\/account-b\?project=project-b"/);
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
  assert.equal(leadTrackingEntityHref(douyin), "/lead_tracking/account-a?project=project-a");
  assert.equal(leadTrackingEntityHref(douyin, "project-b"), "/lead_tracking/account-b?project=project-b");
  const escaped = groupLeadTrackingEntities([{ ...account, id: "a/b", project_id: "p&x" }])[0];
  assert.equal(leadTrackingEntityHref(escaped), "/lead_tracking/a%2Fb?project=p%26x");
});

test("project sidebar preserves existing defaults and isolates Lead Tracking collapse state", () => {
  const sidebar = readFileSync(new URL("../../components/publishing/PublishingProjectSidebar.tsx", import.meta.url), "utf8");
  assert.match(sidebar, /module = accountContent \? "accountContent" : "publishing"/);
  assert.match(sidebar, /path: "\/lead_tracking", storage: "amp-lead-tracking-sidebar-collapsed"/);
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
  assert.match(html, /Demo data/);
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
