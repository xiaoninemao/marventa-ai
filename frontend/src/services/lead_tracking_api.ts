import { API_BASE, auth_headers, response_error } from "./api_core";
import { apiError } from "@/i18n/errors";
import type { ItemResponse } from "@/types/publishing";
import type {
  LeadReviewStatus,
  LeadTrackingAnalysis,
  LeadTrackingCommentInsight,
} from "@/types/lead_tracking";

const statuses = new Set(["completed", "partial", "unavailable", "failed"]);

export async function fetch_lead_tracking_comment_insight(
  projectId: string, accountId: string, date = "", signal?: AbortSignal,
): Promise<ItemResponse<LeadTrackingCommentInsight>> {
  const query = new URLSearchParams();
  if (date) query.set("date", date);
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
