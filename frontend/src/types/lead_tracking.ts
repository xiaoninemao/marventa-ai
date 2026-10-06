export type LeadTrackingRunStatus = "completed" | "partial" | "unavailable" | "failed";

export interface LeadTrackingComment {
  comment_id: string;
  comment_user_id: string;
  content: string;
  create_time: number;
  digg_count: number;
  reply_comment_total: number;
  top: boolean;
  item_id: string;
  interaction_score: number;
}

export interface LeadTrackingCommentInsight {
  status: LeadTrackingRunStatus;
  date: string;
  timezone: string;
  top_limit: number;
  items: LeadTrackingComment[];
  is_simulated: boolean;
  limited: boolean;
  message: string;
  last_synced_at: string;
}

export type LeadIntent = "high" | "medium" | "low";
export type LeadReviewStatus = "pending" | "confirmed" | "dismissed";

export interface LeadTrackingLead {
  comment_id: string;
  comment_user_id: string;
  content: string;
  create_time: number;
  item_id: string;
  score: number;
  intent: LeadIntent;
  demand_labels: string[];
  evidence: string[];
  recommended_action: string;
  review_status: LeadReviewStatus;
  reviewed_at: string;
}

export interface LeadTrackingAnalysis {
  status: "completed" | "unavailable" | "failed";
  date: string;
  timezone: string;
  analysis_method: "rules" | "ai";
  model: string;
  rule_version: string;
  is_simulated: boolean;
  items: LeadTrackingLead[];
  analyzed_count: number;
  high_count: number;
  medium_count: number;
  low_count: number;
  pending_count: number;
  generated_at: string;
  message: string;
}
