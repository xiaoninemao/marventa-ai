"use client";

import { useMemo, useState } from "react";
import { useI18n } from "@/contexts/i18n_context";
import WorkspaceEmptyState from "@/components/redesign/WorkspaceEmptyState";
import { GuardedButton } from "@/components/redesign/GuardedControls";
import EnterpriseSelect from "@/components/redesign/EnterpriseSelect";
import RedesignInput from "@/components/redesign/RedesignInput";
import InlineIcon from "@/components/redesign/InlineIcon";
import type {
  LeadIntent,
  LeadReviewStatus,
  LeadTrackingAnalysis,
  LeadTrackingLead,
} from "@/types/lead_tracking";

const intentOrder: Record<LeadIntent, number> = { high: 0, medium: 1, low: 2 };

export function isLeadMetricActive(
  key: "high" | "medium" | "pending" | "confirmed",
  intent: "all" | LeadIntent,
  review: "all" | LeadReviewStatus,
): boolean {
  if (key === "pending" || key === "confirmed") return review === key;
  return intent === key;
}

export default function LeadAnalysisPanel({
  data, loading, error, onRetry, onReview, reviewingCommentId,
}: {
  data: LeadTrackingAnalysis | null;
  loading: boolean;
  error: string;
  onRetry: () => void;
  onReview: (commentId: string, status: LeadReviewStatus) => void;
  reviewingCommentId: string;
}) {
  const { t, locale } = useI18n();
  const [query, setQuery] = useState("");
  const [intent, setIntent] = useState<"all" | LeadIntent>("all");
  const [review, setReview] = useState<"all" | LeadReviewStatus>("all");
  const labels = useMemo<Record<string, string>>(() => ({
    pricing: t("价格与采购", "Pricing & purchase"),
    demo_trial: t("演示与试用", "Demo & trial"),
    integration: t("系统集成", "Integrations"),
    deployment_security: t("部署与安全", "Deployment & security"),
    permissions_workflow: t("权限与流程", "Permissions & workflow"),
    reporting_data: t("报表与数据", "Reporting & data"),
    support_onboarding: t("服务与上线", "Support & onboarding"),
  }), [t]);
  const evidence: Record<string, string> = {
    purchase_intent: t("包含采购意向", "Purchase intent"),
    demo_or_trial: t("主动提出演示或试用", "Requested demo or trial"),
    concrete_requirement: t("包含明确需求", "Concrete requirement"),
    urgency: t("包含时间要求", "Time-sensitive"),
    engagement: t("互动表现较高", "Strong engagement"),
    direct_question: t("直接提出问题", "Direct question"),
  };
  const actions: Record<string, string> = {
    schedule_demo: t("安排产品演示", "Schedule a demo"),
    send_pricing: t("发送报价方案", "Send pricing"),
    technical_review: t("转售前技术评估", "Route to technical review"),
    contact_now: t("优先联系", "Contact now"),
    send_materials: t("发送产品资料", "Send product materials"),
    monitor: t("暂时观察", "Monitor"),
  };
  const intentLabels: Record<LeadIntent, string> = {
    high: t("高意向", "High intent"),
    medium: t("中意向", "Medium intent"),
    low: t("低意向", "Low intent"),
  };
  const reviewLabels: Record<LeadReviewStatus, string> = {
    pending: t("待确认", "Pending"),
    confirmed: t("已确认", "Confirmed"),
    dismissed: t("已忽略", "Dismissed"),
  };
  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase(locale);
    return [...(data?.items || [])]
      .filter((item) => intent === "all" || item.intent === intent)
      .filter((item) => review === "all" || item.review_status === review)
      .filter((item) => !normalized || [
        item.content, item.comment_user_id,
        ...item.demand_labels.map((value) => labels[value] || value),
      ].some((value) => value.toLocaleLowerCase(locale).includes(normalized)))
      .sort((left, right) => intentOrder[left.intent] - intentOrder[right.intent]
        || right.score - left.score || right.create_time - left.create_time);
  }, [data?.items, intent, labels, locale, query, review]);

  if (loading) return <div className="amp-page-state" role="status">{t("线索分析加载中…", "Loading lead analysis…")}</div>;
  if (error) return <div className="amp-projects-state" role="alert"><strong>{error}</strong>
    <button type="button" className="amp-button amp-button-secondary" onClick={onRetry}>{t("重试", "Retry")}</button></div>;
  if (!data || data.status === "unavailable") return <WorkspaceEmptyState icon="target"
    title={t("尚未生成线索分析", "No lead analysis yet")}
    description={t("完成下一次每日评论同步后，系统会自动生成线索分析。",
      "Lead analysis will be generated automatically after the next daily comment sync.")} />;
  if (data.status === "failed") return <WorkspaceEmptyState icon="target"
    title={t("线索分析失败", "Lead analysis failed")}
    description={t("自动分析未完成，可点击右上角“重新分析”再次尝试。",
      "Automatic analysis did not complete. Select Reanalyze to try again.")} />;

  const confirmedCount = data.items.filter((item) => item.review_status === "confirmed").length;
  const metrics = [
    [t("高意向", "High intent"), data.high_count, "high"],
    [t("中意向", "Medium intent"), data.medium_count, "medium"],
    [t("待确认", "Pending review"), data.pending_count, "pending"],
    [t("已确认", "Confirmed"), confirmedCount, "confirmed"],
  ] as const;
  return <div className="amp-lead-analysis">
    <div className="amp-lead-analysis-meta">
      <div>
        {data.is_simulated && <span className="amp-badge amp-badge-muted">{t("模拟数据", "Demo data")}</span>}
        <span>{data.date}</span><span>{data.timezone}</span>
        <span>{data.analysis_method === "ai"
          ? t("AI 模型 {model}", "AI model {model}", { model: data.model })
          : t("规则版本 {version}", "Rule version {version}", { version: data.rule_version })}</span>
      </div>
      {data.generated_at && <time dateTime={data.generated_at}>
        {t("分析于 {time}", "Analyzed {time}", { time: new Date(data.generated_at).toLocaleString(locale) })}
      </time>}
    </div>
    <div className="amp-lead-analysis-metrics" aria-label={t("线索分析摘要", "Lead analysis summary")}>
      {metrics.map(([label, value, key]) => <button key={key} type="button"
        className={isLeadMetricActive(key, intent, review) ? "is-active" : ""}
        onClick={() => {
          if (key === "pending" || key === "confirmed") {
            setReview(review === key && intent === "all" ? "all" : key);
            setIntent("all");
          } else {
            setIntent(intent === key && review === "all" ? "all" : key);
            setReview("all");
          }
        }}>
        <span>{label}</span><strong>{value}</strong>
      </button>)}
    </div>
    <div className="amp-lead-analysis-toolbar">
      <div className="amp-projects-search">
        <RedesignInput type="search" value={query} onChange={(event) => setQuery(event.target.value)}
          leftIcon={<InlineIcon name="search" className="h-4 w-4" />}
          placeholder={t("搜索评论、用户或需求", "Search comments, users, or needs")}
          aria-label={t("搜索线索", "Search leads")} />
      </div>
      <EnterpriseSelect value={intent} onChange={setIntent}
        options={[
          { value: "all", label: t("全部意向", "All intent levels") },
          { value: "high", label: intentLabels.high },
          { value: "medium", label: intentLabels.medium },
          { value: "low", label: intentLabels.low },
        ]}
        ariaLabel={t("意向等级", "Intent level")} className="w-36" />
      <EnterpriseSelect value={review} onChange={setReview}
        options={[
          { value: "all", label: t("全部状态", "All review states") },
          { value: "pending", label: reviewLabels.pending },
          { value: "confirmed", label: reviewLabels.confirmed },
          { value: "dismissed", label: reviewLabels.dismissed },
        ]}
        ariaLabel={t("确认状态", "Review status")} className="w-36" />
    </div>
    {filtered.length ? <div className="amp-lead-analysis-table" role="table"
      aria-label={t("评论线索分析结果", "Comment lead analysis results")}>
      {filtered.map((item) => <LeadRow key={item.comment_id} item={item} locale={locale}
        labels={labels} evidence={evidence} actions={actions} intentLabels={intentLabels}
        reviewLabels={reviewLabels} busy={reviewingCommentId === item.comment_id}
        onReview={onReview} t={t} />)}
    </div> : <WorkspaceEmptyState icon="search"
      title={t("没有符合条件的线索", "No matching leads")}
      description={t("调整搜索词或筛选条件后重试。", "Adjust the search or filters and try again.")} />}
  </div>;
}

function LeadRow({
  item, locale, labels, evidence, actions, intentLabels, reviewLabels, busy, onReview, t,
}: {
  item: LeadTrackingLead;
  locale: string;
  labels: Record<string, string>;
  evidence: Record<string, string>;
  actions: Record<string, string>;
  intentLabels: Record<LeadIntent, string>;
  reviewLabels: Record<LeadReviewStatus, string>;
  busy: boolean;
  onReview: (commentId: string, status: LeadReviewStatus) => void;
  t: (zh: string, en: string, values?: Record<string, string | number>) => string;
}) {
  return <div className="amp-lead-analysis-row" role="row">
    <div className="amp-lead-analysis-score" role="cell">
      <strong>{item.score}</strong>
      <span className={`is-${item.intent}`}>{intentLabels[item.intent]}</span>
    </div>
    <div className="amp-lead-analysis-body" role="cell">
      <div className="amp-lead-analysis-comment">
        <p>{item.content || t("评论正文不可用", "Comment text unavailable")}</p>
        <span>{t("评论用户 {id}", "Commenter {id}", { id: item.comment_user_id || "—" })}</span>
        <time dateTime={new Date(item.create_time * 1000).toISOString()}>
          {new Date(item.create_time * 1000).toLocaleString(locale)}
        </time>
      </div>
      <div className="amp-lead-analysis-signals">
        <div>{item.demand_labels.length
          ? item.demand_labels.map((label) => <span key={label}>{labels[label] || label}</span>)
          : <span className="is-muted">{t("未识别明确需求", "No specific need identified")}</span>}</div>
        <ul>{item.evidence.map((value) => <li key={value}>{evidence[value] || value}</li>)}</ul>
      </div>
    </div>
    <div className="amp-lead-analysis-outcome" role="cell">
      <div className="amp-lead-analysis-action">
        <span>{t("建议动作", "Recommended action")}</span>
        <strong>{actions[item.recommended_action] || item.recommended_action}</strong>
      </div>
      <div className="amp-lead-analysis-review">
        <span className={`is-${item.review_status}`}>{reviewLabels[item.review_status]}</span>
        <div>
          {item.review_status !== "confirmed" && <GuardedButton type="button" disabled={busy}
            blockedReason={t("人工确认状态正在更新。", "The review status is being updated.")}
            onClick={() => onReview(item.comment_id, "confirmed")}>{t("确认", "Confirm")}</GuardedButton>}
          {item.review_status !== "dismissed" && <GuardedButton type="button" disabled={busy}
            blockedReason={t("人工确认状态正在更新。", "The review status is being updated.")}
            onClick={() => onReview(item.comment_id, "dismissed")}>{t("忽略", "Dismiss")}</GuardedButton>}
          {item.review_status !== "pending" && <GuardedButton type="button" disabled={busy}
            blockedReason={t("人工确认状态正在更新。", "The review status is being updated.")}
            onClick={() => onReview(item.comment_id, "pending")}>{t("重置", "Reset")}</GuardedButton>}
        </div>
      </div>
    </div>
  </div>;
}
