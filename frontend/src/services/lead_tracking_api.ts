import { API_BASE, auth_headers, response_error } from "./api_core";
import { apiError } from "@/i18n/errors";
import type { ItemResponse } from "@/types/publishing";
import type {
  DailyCommentReport,
  LeadReviewStatus,
  LeadTrackingAnalysis,
  LeadTrackingCommentInsight,
  LeadTrackingWork,
  OpinionOverview,
  OpinionDetails,
  OpinionActionSummary,
  OpinionStrategy,
} from "@/types/lead_tracking";

const statuses = new Set(["completed", "partial", "unavailable", "failed"]);

export async function fetch_lead_tracking_works(
  projectId: string, accountId: string, signal?: AbortSignal,
): Promise<LeadTrackingWork[]> {
  const response = await fetch(
    `${API_BASE}/api/v1/publishing/projects/${encodeURIComponent(projectId)}/channel-accounts/${encodeURIComponent(accountId)}/lead-tracking/works`,
    { headers: auth_headers(), signal, cache: "no-store" },
  );
  if (!response.ok) throw await response_error(response, "Could not load account works");
  const body: ItemResponse<LeadTrackingWork[]> = await response.json();
  if (!body.success || !Array.isArray(body.data) || body.data.some((work) =>
    !work || typeof work.item_id !== "string" || !work.item_id
    || typeof work.title !== "string" || typeof work.share_url !== "string")) {
    throw apiError("Account works response is invalid");
  }
  return body.data;
}

export async function fetch_lead_tracking_comment_insight(
  projectId: string, accountId: string, date = "", signal?: AbortSignal, itemId = "",
): Promise<ItemResponse<LeadTrackingCommentInsight>> {
  const query = new URLSearchParams();
  if (date) query.set("date", date);
  if (itemId) query.set("item_id", itemId);
  const response = await fetch(
    `${API_BASE}/api/v1/publishing/projects/${encodeURIComponent(projectId)}/channel-accounts/${encodeURIComponent(accountId)}/lead-tracking/comment-insights${query.size ? `?${query}` : ""}`,
    { headers: auth_headers(), signal, cache: "no-store" },
  );
  if (!response.ok) throw await response_error(response, "Could not load daily comment insights");
  const body: ItemResponse<LeadTrackingCommentInsight> = await response.json();
  const data = body.data;
  if (!body.success || !data || !statuses.has(data.status) || !/^\d{4}-\d{2}-\d{2}$/.test(data.date)
    || typeof data.timezone !== "string" || data.top_limit !== 50 || !Array.isArray(data.items)
    || typeof data.is_simulated !== "boolean" || typeof data.limited !== "boolean"
    || typeof data.message !== "string" || typeof data.last_synced_at !== "string"
    || data.items.length > data.top_limit || data.items.some((item) =>
      !item || typeof item !== "object" || !item.comment_id || !item.item_id || typeof item.comment_user_id !== "string"
      || typeof item.content !== "string" || !Number.isInteger(item.create_time) || item.create_time < 0
      || !Number.isInteger(item.digg_count) || item.digg_count < 0
      || !Number.isInteger(item.reply_comment_total) || item.reply_comment_total < 0
      || typeof item.top !== "boolean" || !Number.isInteger(item.interaction_score) || item.interaction_score < 0)) {
    throw apiError("Lead tracking comment insight response is invalid");
  }
  return body;
}

function analysisPath(projectId: string, accountId: string, date = ""): string {
  const query = new URLSearchParams();
  if (date) query.set("date", date);
  return `${API_BASE}/api/v1/publishing/projects/${encodeURIComponent(projectId)}/channel-accounts/${encodeURIComponent(accountId)}/lead-tracking/analysis${query.size ? `?${query}` : ""}`;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function validateAnalysis(body: ItemResponse<LeadTrackingAnalysis>): ItemResponse<LeadTrackingAnalysis> {
  const data = body.data;
  if (!body.success || !data || !["completed", "unavailable", "failed"].includes(data.status)
    || !/^\d{4}-\d{2}-\d{2}$/.test(data.date) || typeof data.timezone !== "string"
    || !["rules", "ai"].includes(data.analysis_method) || typeof data.model !== "string"
    || (data.analysis_method === "ai" && !data.model)
    || (data.analysis_method === "rules" && data.model !== "")
    || typeof data.rule_version !== "string" || typeof data.is_simulated !== "boolean"
    || !Array.isArray(data.items) || !Number.isInteger(data.analyzed_count) || data.analyzed_count < 0
    || !Number.isInteger(data.high_count) || data.high_count < 0
    || !Number.isInteger(data.medium_count) || data.medium_count < 0
    || !Number.isInteger(data.low_count) || data.low_count < 0
    || !Number.isInteger(data.pending_count) || data.pending_count < 0
    || typeof data.generated_at !== "string" || typeof data.message !== "string"
    || data.analyzed_count !== data.items.length
    || data.high_count + data.medium_count + data.low_count !== data.analyzed_count
    || data.items.some((item) =>
      !item || typeof item !== "object" || !item.comment_id || typeof item.comment_user_id !== "string"
      || typeof item.content !== "string" || !item.item_id || !Number.isInteger(item.create_time)
      || item.create_time < 0 || !Number.isInteger(item.score) || item.score < 0 || item.score > 100
      || !["high", "medium", "low"].includes(item.intent)
      || !isStringArray(item.demand_labels) || !isStringArray(item.evidence)
      || typeof item.recommended_action !== "string"
      || !["pending", "confirmed", "dismissed"].includes(item.review_status)
      || typeof item.reviewed_at !== "string")) {
    throw apiError("Lead tracking analysis response is invalid");
  }
  return body;
}

export async function fetch_lead_tracking_analysis(
  projectId: string, accountId: string, date = "", signal?: AbortSignal,
): Promise<ItemResponse<LeadTrackingAnalysis>> {
  const response = await fetch(analysisPath(projectId, accountId, date), {
    headers: auth_headers(), signal, cache: "no-store",
  });
  if (!response.ok) throw await response_error(response, "Could not load lead analysis");
  return validateAnalysis(await response.json());
}

export async function run_lead_tracking_analysis(
  projectId: string, accountId: string, date = "",
): Promise<ItemResponse<LeadTrackingAnalysis>> {
  const response = await fetch(analysisPath(projectId, accountId, date), {
    method: "POST", headers: auth_headers(),
  });
  if (!response.ok) throw await response_error(response, "Could not analyze comments");
  return validateAnalysis(await response.json());
}

export async function review_lead_tracking_item(
  projectId: string, accountId: string, commentId: string,
  status: LeadReviewStatus, date = "",
): Promise<ItemResponse<LeadTrackingAnalysis>> {
  const base = analysisPath(projectId, accountId, date);
  const [path, query = ""] = base.split("?");
  const response = await fetch(`${path}/${encodeURIComponent(commentId)}${query ? `?${query}` : ""}`, {
    method: "PATCH",
    headers: { ...auth_headers(), "Content-Type": "application/json" },
    body: JSON.stringify({ status }),
  });
  if (!response.ok) throw await response_error(response, "Could not update lead review");
  return validateAnalysis(await response.json());
}

function reportPath(projectId: string, accountId: string): string {
  return `${API_BASE}/api/v1/publishing/projects/${encodeURIComponent(projectId)}/channel-accounts/${encodeURIComponent(accountId)}/lead-tracking`;
}

export async function fetch_opinion_overview(
  projectId: string, accountId: string, days: 7 | 30, signal?: AbortSignal,
): Promise<ItemResponse<OpinionOverview>> {
  const response = await fetch(`${reportPath(projectId, accountId)}/opinion-overview?days=${days}`, {
    headers: auth_headers(), signal, cache: "no-store",
  });
  if (!response.ok) throw await response_error(response, "Could not load opinion overview");
  const body: ItemResponse<OpinionOverview> = await response.json();
  const data = body.data;
  const validPercent = (value: number) => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100;
  if (!body.success || !data || !["completed", "unavailable"].includes(data.status)
    || data.period_days !== days || !/^\d{4}-\d{2}-\d{2}$/.test(data.start_date)
    || !/^\d{4}-\d{2}-\d{2}$/.test(data.end_date) || typeof data.timezone !== "string"
    || typeof data.is_simulated !== "boolean" || !Number.isInteger(data.covered_days)
    || data.covered_days < 0 || data.covered_days > days || !Number.isInteger(data.incomplete_days)
    || data.incomplete_days < 0 || data.incomplete_days > data.covered_days
    || !Number.isInteger(data.comments_collected) || data.comments_collected < 0
    || !Number.isInteger(data.distinct_users) || data.distinct_users < 0
    || typeof data.last_synced_at !== "string" || !validPercent(data.question_percent)
    || !validPercent(data.demand_percent) || !Array.isArray(data.daily)
    || !Array.isArray(data.sentiments) || !Array.isArray(data.themes) || !Array.isArray(data.words)
    || !Array.isArray(data.keyword_clusters)
    || !["ready", "insufficient_data", "unavailable"].includes(data.theme_status)
    || data.daily.length > days || data.daily.some((point) => !/^\d{4}-\d{2}-\d{2}$/.test(point.date)
      || (point.comments !== null && (!Number.isInteger(point.comments) || point.comments < 0))
      || (point.negative_percent !== null && !validPercent(point.negative_percent)))
    || [...data.sentiments, ...data.themes].some((share) => !share.key || !share.label
      || !Number.isInteger(share.count) || share.count < 0 || !validPercent(share.percent))
    || data.words.some((word) => !word.word || typeof word.weight !== "number"
      || !Number.isFinite(word.weight) || word.weight < 0 || word.weight > 1)
    || data.keyword_clusters.some((cluster) => !cluster.key || !cluster.label
      || !Number.isInteger(cluster.count) || cluster.count < 0 || !validPercent(cluster.percent)
      || !isStringArray(cluster.keywords))) {
    throw apiError("Opinion overview response is invalid");
  }
  return body;
}

export async function fetch_opinion_details(
  projectId: string, accountId: string, days: 7 | 30, signal?: AbortSignal,
): Promise<ItemResponse<OpinionDetails>> {
  const response = await fetch(`${reportPath(projectId, accountId)}/opinion-details?days=${days}`, {
    headers: auth_headers(), signal, cache: "no-store",
  });
  if (!response.ok) throw await response_error(response, "Could not load opinion details");
  const body: ItemResponse<OpinionDetails> = await response.json();
  const data = body.data;
  if (!body.success || !data || data.period_days !== days || typeof data.is_simulated !== "boolean"
    || !Array.isArray(data.posts) || !Array.isArray(data.comments)
    || !data.performance || !Number.isInteger(data.performance.post_count) || data.performance.post_count < 0
    || !Number.isInteger(data.performance.risk_count) || data.performance.risk_count < 0
    || [data.performance.views, data.performance.engagement].some((value) => value !== null
      && (typeof value !== "number" || !Number.isInteger(value) || value < 0))
    || !Array.isArray(data.performance.daily) || data.performance.daily.length !== days
    || data.performance.daily.some((point) => typeof point.date !== "string"
      || !/^\d{4}-\d{2}-\d{2}$/.test(point.date)
      || [point.views, point.engagement, point.previous_views, point.previous_engagement].some((value) => value !== null
        && (typeof value !== "number" || !Number.isInteger(value) || value < 0)))
    || data.posts.some((post) => typeof post.item_id !== "string" || !post.item_id
      || typeof post.title !== "string" || !post.title || typeof post.share_url !== "string"
      || typeof post.published_at !== "string" || typeof post.platform !== "string"
      || [post.views, post.engagement, post.rate].some((value) => value !== null
        && (typeof value !== "number" || !Number.isFinite(value) || value < 0))
      || typeof post.summary !== "string")
    || data.comments.some((comment) => typeof comment.comment_id !== "string" || !comment.comment_id
      || typeof comment.item_id !== "string" || !comment.item_id
      || typeof comment.item_title !== "string" || typeof comment.share_url !== "string"
      || typeof comment.author !== "string" || !comment.author
      || typeof comment.content !== "string" || !comment.content
      || typeof comment.created_at !== "string" || !comment.created_at
      || typeof comment.topic !== "string" || typeof comment.platform !== "string"
      || !["positive", "neutral", "negative"].includes(comment.mood)
      || typeof comment.review_required !== "boolean" || !isStringArray(comment.evidence)
      || !Number.isInteger(comment.likes) || comment.likes < 0
      || !Number.isInteger(comment.replies) || comment.replies < 0)) {
    throw apiError("Opinion details response is invalid");
  }
  return body;
}

function validateOpinionActions(body: ItemResponse<OpinionActionSummary>, days: 7 | 30): ItemResponse<OpinionActionSummary> {
  const data = body.data;
  if (!body.success || !data || data.period_days !== days || !Array.isArray(data.actions)
    || !/^\d{4}-\d{2}-\d{2}$/.test(data.start_date) || !/^\d{4}-\d{2}-\d{2}$/.test(data.end_date)
    || typeof data.llm_available !== "boolean" || typeof data.is_simulated !== "boolean"
    || !Number.isInteger(data.report_days) || data.report_days < 0 || data.report_days > days
    || !Number.isInteger(data.pending_review_comments) || data.pending_review_comments < 0
    || !Number.isInteger(data.negative_feedback_comments) || data.negative_feedback_comments < 0
    || data.actions.some((action) => !action.id || !action.topic
      || !["pending", "accepted"].includes(action.status) || typeof action.completed !== "boolean"
      || !/^\d{4}-\d{2}-\d{2}$/.test(action.latest_date) || !isStringArray(action.source_dates)
      || !Number.isInteger(action.report_count) || action.report_count < 1
      || typeof action.conclusion !== "string" || typeof action.product_suggestion !== "string"
      || typeof action.marketing_suggestion !== "string" || !isStringArray(action.evidence_comment_ids))) {
    throw apiError("Opinion actions response is invalid");
  }
  return body;
}

export async function fetch_opinion_actions(
  projectId: string, accountId: string, days: 7 | 30, signal?: AbortSignal,
): Promise<ItemResponse<OpinionActionSummary>> {
  const response = await fetch(`${reportPath(projectId, accountId)}/opinion-actions?days=${days}`, {
    headers: auth_headers(), signal, cache: "no-store",
  });
  if (!response.ok) throw await response_error(response, "Could not load opinion actions");
  return validateOpinionActions(await response.json(), days);
}

export async function update_opinion_action(
  projectId: string, accountId: string, days: 7 | 30, actionId: string, completed: boolean,
): Promise<ItemResponse<OpinionActionSummary>> {
  const response = await fetch(`${reportPath(projectId, accountId)}/opinion-actions?days=${days}`, {
    method: "PATCH", headers: { ...auth_headers(), "Content-Type": "application/json" },
    body: JSON.stringify({ action_id: actionId, completed }),
  });
  if (!response.ok) throw await response_error(response, "Could not update opinion action");
  return validateOpinionActions(await response.json(), days);
}

export async function accept_opinion_action(
  projectId: string, accountId: string, days: 7 | 30, actionId: string,
): Promise<ItemResponse<OpinionActionSummary>> {
  const response = await fetch(`${reportPath(projectId, accountId)}/opinion-actions/accept?days=${days}`, {
    method: "POST", headers: { ...auth_headers(), "Content-Type": "application/json" },
    body: JSON.stringify({ action_id: actionId }),
  });
  if (!response.ok) throw await response_error(response, "Could not accept opinion action");
  return validateOpinionActions(await response.json(), days);
}

export async function generate_opinion_strategy(
  projectId: string, accountId: string, days: 7 | 30,
): Promise<ItemResponse<OpinionStrategy>> {
  const response = await fetch(`${reportPath(projectId, accountId)}/opinion-strategy?days=${days}`, {
    method: "POST", headers: auth_headers(), cache: "no-store",
  });
  if (!response.ok) throw await response_error(response, "Could not generate opinion strategy");
  const body: ItemResponse<OpinionStrategy> = await response.json();
  const data = body.data;
  if (!body.success || !data || data.period_days !== days
    || !["completed", "insufficient_data"].includes(data.status) || typeof data.headline !== "string"
    || !Array.isArray(data.recommendations) || data.recommendations.length > 3
    || data.recommendations.some((item) => !item.title || !item.next_step || !item.rationale
      || !isStringArray(item.evidence_action_ids) || !isStringArray(item.source_dates))) {
    throw apiError("Opinion strategy response is invalid");
  }
  return body;
}

function validateDailyReport(body: ItemResponse<DailyCommentReport>): ItemResponse<DailyCommentReport> {
  const data = body.data;
  if (!body.success || !data || !statuses.has(data.status)
    || !/^\d{4}-\d{2}-\d{2}$/.test(data.date)
    || !Array.isArray(data.top_comments) || data.top_comments.length > 10
    || !Array.isArray(data.topics) || typeof data.semantic_status !== "string"
    || typeof data.collection_complete !== "boolean" || typeof data.is_simulated !== "boolean"
    || !Number.isInteger(data.comments_collected) || data.comments_collected < 0
    || !Number.isInteger(data.distinct_users) || data.distinct_users < 0
    || [data.purchase_intent_comments, data.feature_request_comments, data.negative_feedback_comments,
      data.negated_comments, data.pending_review_comments].some((value) => !Number.isInteger(value) || value < 0)
    || data.top_comments.some((item) => !item.comment_id || !item.item_id || typeof item.content !== "string")
    || data.topics.some((item) => !item.topic || !Array.isArray(item.evidence_comment_ids)
      || !["individual_feedback", "needs_validation", "higher_confidence"].includes(item.evidence_level))) {
    throw apiError("Daily comment report response is invalid");
  }
  return body;
}

export async function fetch_daily_comment_report(
  projectId: string, accountId: string, date = "", signal?: AbortSignal,
): Promise<ItemResponse<DailyCommentReport>> {
  const query = date ? `?date=${encodeURIComponent(date)}` : "";
  const response = await fetch(`${reportPath(projectId, accountId)}/daily-reports${query}`, {
    headers: auth_headers(), signal, cache: "no-store",
  });
  if (!response.ok) throw await response_error(response, "Could not load daily comment report");
  return validateDailyReport(await response.json());
}

export async function fetch_daily_report_dates(projectId: string, accountId: string): Promise<string[]> {
  const response = await fetch(`${reportPath(projectId, accountId)}/daily-report-dates`, {
    headers: auth_headers(), cache: "no-store",
  });
  if (!response.ok) throw await response_error(response, "Could not load report dates");
  const body: ItemResponse<string[]> = await response.json();
  if (!body.success || !Array.isArray(body.data) || body.data.some((date) => !/^\d{4}-\d{2}-\d{2}$/.test(date))) {
    throw apiError("Daily report dates response is invalid");
  }
  return body.data;
}

export async function review_daily_report_comment(
  projectId: string, accountId: string, date: string, commentId: string,
  stance: "support" | "oppose" | "neutral" | "uncertain",
): Promise<ItemResponse<DailyCommentReport>> {
  const response = await fetch(`${reportPath(projectId, accountId)}/daily-comment-reviews?date=${encodeURIComponent(date)}`, {
    method: "PATCH", headers: { ...auth_headers(), "Content-Type": "application/json" },
    body: JSON.stringify({ comment_id: commentId, stance }),
  });
  if (!response.ok) throw await response_error(response, "Could not review daily comment");
  return validateDailyReport(await response.json());
}

export async function download_daily_comment_report(
  projectId: string, accountId: string, date: string, format: "md" | "json" = "md", itemId = "",
): Promise<Blob> {
  const query = new URLSearchParams({ date, format });
  if (itemId) query.set("item_id", itemId);
  const response = await fetch(
    `${reportPath(projectId, accountId)}/daily-report-download?${query}`,
    { headers: auth_headers(), cache: "no-store" },
  );
  if (!response.ok) throw await response_error(response, "Could not download daily comment report");
  return response.blob();
}
