export type LeadTrackingRunStatus = "completed" | "partial" | "unavailable" | "failed";

export interface LeadTrackingWork {
  item_id: string;
  title: string;
  share_url: string;
}

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

export interface DailyReportComment {
  comment_id: string;
  item_id: string;
  item_title: string;
  share_url: string;
  content: string;
  comment_user_id: string;
  create_time: number;
  digg_count: number;
  reply_comment_total: number;
  interaction_score: number;
  topics: string[];
  stance: "support" | "oppose" | "neutral" | "uncertain";
  signals: string[];
  pending_review: boolean;
  reviewed: boolean;
  review_reason: string;
  model_confidence: number | null;
}

export interface DailyReportTopic {
  topic: string;
  conclusion?: string;
  supporting_comments: number;
  opposing_comments: number;
  neutral_comments: number;
  distinct_users: number;
  works: number;
  evidence_level: "individual_feedback" | "needs_validation" | "higher_confidence";
  trend: "insufficient_history" | "rising" | "falling" | "stable";
  evidence_comment_ids: string[];
  quotes: string[];
  evidence_sources?: Array<{ item_id: string; item_title: string; share_url: string }>;
  product_suggestion: string;
  marketing_suggestion: string;
  decision: "pending" | "accepted" | "dismissed";
}

export interface DailyReportWorkAnalysis {
  item_id: string;
  item_title: string;
  share_url: string;
  comments_collected: number;
  distinct_users: number;
  topics: DailyReportTopic[];
  comments: DailyReportComment[];
}

export interface DailyCommentReport {
  status: "completed" | "partial" | "unavailable" | "failed";
  date: string;
  timezone: string;
  organization_id: string;
  account_key: string;
  platform: string;
  source: string;
  is_simulated: boolean;
  collection_complete: boolean;
  comments_collected: number;
  distinct_users: number;
  works_with_comments: number;
  purchase_intent_comments: number;
  feature_request_comments: number;
  negative_feedback_comments: number;
  negated_comments: number;
  pending_review_comments: number;
  top_comments: DailyReportComment[];
  topics: DailyReportTopic[];
  work_analyses?: DailyReportWorkAnalysis[];
  selected_item_id?: string;
  semantic_status: string;
  model_version: string;
  llm_used: boolean;
  message: string;
  generated_at: string;
}

export interface OpinionDailyPoint {
  date: string;
  comments: number | null;
  negative_percent: number | null;
}

export interface OpinionShare {
  key: string;
  label: string;
  count: number;
  percent: number;
}

export interface OpinionOverview {
  status: "completed" | "unavailable";
  period_days: 7 | 30;
  start_date: string;
  end_date: string;
  timezone: string;
  is_simulated: boolean;
  covered_days: number;
  incomplete_days: number;
  comments_collected: number;
  distinct_users: number;
  last_synced_at: string;
  daily: OpinionDailyPoint[];
  question_percent: number;
  demand_percent: number;
  sentiments: OpinionShare[];
  themes: OpinionShare[];
  words: Array<{ word: string; weight: number }>;
  keyword_clusters: Array<{ key: string; label: string; count: number; percent: number; keywords: string[] }>;
  theme_status: "ready" | "insufficient_data" | "unavailable";
}

export interface OpinionPost {
  item_id: string;
  title: string;
  share_url: string;
  published_at: string;
  platform: string;
  views: number | null;
  engagement: number | null;
  rate: number | null;
  summary: string;
}

export interface OpinionVoice {
  comment_id: string;
  item_id: string;
  item_title: string;
  share_url: string;
  author: string;
  content: string;
  created_at: string;
  likes: number;
  replies: number;
  topic: string;
  mood: "positive" | "neutral" | "negative";
  review_required: boolean;
  evidence: string[];
  platform: string;
}

export interface OpinionDetails {
  period_days: 7 | 30;
  is_simulated: boolean;
  posts: OpinionPost[];
  comments: OpinionVoice[];
  performance: OpinionPerformance;
}

export interface OpinionPerformancePoint {
  date: string;
  views: number | null;
  engagement: number | null;
  previous_views: number | null;
  previous_engagement: number | null;
}

export interface OpinionPerformance {
  post_count: number;
  views: number | null;
  engagement: number | null;
  risk_count: number;
  daily: OpinionPerformancePoint[];
}

export interface OpinionAction {
  id: string;
  topic: string;
  status: "pending" | "accepted";
  completed: boolean;
  latest_date: string;
  source_dates: string[];
  report_count: number;
  conclusion: string;
  product_suggestion: string;
  marketing_suggestion: string;
  evidence_comment_ids: string[];
}

export interface OpinionActionSummary {
  period_days: 7 | 30;
  start_date: string;
  end_date: string;
  is_simulated: boolean;
  report_days: number;
  pending_review_comments: number;
  negative_feedback_comments: number;
  actions: OpinionAction[];
  llm_available: boolean;
}

export interface OpinionStrategy {
  status: "completed" | "insufficient_data";
  period_days: 7 | 30;
  headline: string;
  recommendations: Array<{
    title: string;
    next_step: string;
    rationale: string;
    evidence_action_ids: string[];
    source_dates: string[];
  }>;
}
