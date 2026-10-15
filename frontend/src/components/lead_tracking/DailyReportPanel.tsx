"use client";

import { useI18n } from "@/contexts/i18n_context";
import WorkspaceEmptyState from "@/components/redesign/WorkspaceEmptyState";
import type { DailyCommentReport, DailyReportTopic } from "@/types/lead_tracking";

const levelZh: Record<DailyReportTopic["evidence_level"], string> = {
  individual_feedback: "个别反馈",
  needs_validation: "待验证需求",
  higher_confidence: "较高可信度需求",
};
const levelEn: Record<DailyReportTopic["evidence_level"], string> = {
  individual_feedback: "Individual feedback",
  needs_validation: "Needs validation",
  higher_confidence: "Higher confidence need",
};
const trendZh: Record<DailyReportTopic["trend"], string> = {
  insufficient_history: "历史不足",
  rising: "讨论增加",
  falling: "讨论减少",
  stable: "讨论平稳",
};
const trendEn: Record<DailyReportTopic["trend"], string> = {
  insufficient_history: "Insufficient history",
  rising: "Rising mentions",
  falling: "Falling mentions",
  stable: "Stable mentions",
};

export default function DailyReportPanel({ report, loading, error, onRetry }: {
  report: DailyCommentReport | null;
  loading: boolean;
  error: string;
  onRetry: () => void;
}) {
  const { t } = useI18n();
  return <div className="amp-daily-report">
    {loading && <div className="amp-page-state" role="status">{t("正在加载每日简报…", "Loading daily report…")}</div>}
    {!loading && (error || report?.status === "failed") &&
      <div className="amp-projects-state" role="alert">
        <strong>{t("日报加载失败", "Could not load report")}</strong>
        <p>{error || report?.message || t("请重试。", "Please try again.")}</p>
        <button type="button" className="amp-button amp-button-secondary" onClick={onRetry}>{t("重试", "Retry")}</button>
      </div>}
    {!loading && !error && (!report || report.status === "unavailable") &&
      <WorkspaceEmptyState icon="calendar" title={t("暂无日报", "No daily report")}
        description={t("完成评论同步后生成。", "Available after comment sync.")} />}
    {!loading && !error && report && ["completed", "partial"].includes(report.status) && <>
      {process.env.NODE_ENV === "development" && report.is_simulated && <div className="amp-daily-report-note" role="status">
        <strong>{t("本地模拟数据 · 仅供功能预览", "Local simulated data · preview only")}</strong>
        <span>{t("评论、用户和作品均为虚构，不代表真实平台舆情；本次不会发送正式日报通知。", "Comments, users and works are fictional and do not represent real platform opinion. No official report notification is sent.")}</span>
      </div>}
      {process.env.NODE_ENV === "development" && report.is_simulated && <div className="amp-daily-report-note">
        <strong>{t("模拟评论快照", "Simulated comment snapshot")}</strong>
        <span>{t("虚构样本用于体验分析流程；互动量不代表真实需求普遍性。", "Fictional samples demonstrate analysis. Engagement does not establish real-world demand.")}</span>
        <span>{report.semantic_status === "fine_tuned_bert"
          ? t("已使用经验证的语义模型；不确定结果待人工复核。", "Validated semantic model used; uncertain results await review.")
          : t("语义模型尚未启用或不可用；规则识别结果均待人工复核。", "Semantic model unavailable; rule-based signals all await human review.")}</span>
      </div>}
      <section id="daily-report-opinion">
        <h2>{t("反馈分析", "Feedback analysis")}</h2>
        {report.topics.length === 0 && <p>{t("暂无可归纳的评论。", "No comments to summarize yet.")}</p>}
        <div className="amp-daily-report-list">{report.topics.map((topic) => <article key={topic.topic}>
          <div className="amp-daily-report-topic-heading"><h3>{topic.topic}</h3>
            <span>{t(levelZh[topic.evidence_level], levelEn[topic.evidence_level])}</span></div>
          {topic.conclusion && <p><strong>{t("归纳结论：", "Summary: ")}</strong>{topic.conclusion}</p>}
          <p><strong>{t("产品建议：", "Product suggestion: ")}</strong>{topic.product_suggestion}</p>
          <p><strong>{t("营销建议：", "Marketing suggestion: ")}</strong>{topic.marketing_suggestion}</p>
          <p className="amp-daily-report-meta">
            {t("支持", "Support")} {topic.supporting_comments} · {t("反对", "Oppose")} {topic.opposing_comments} · {t("中立或不确定", "Neutral or uncertain")} {topic.neutral_comments} · {t("不同用户", "Distinct users")} {topic.distinct_users}
            {" · "}{t("作品", "Works")} {topic.works} · {t(trendZh[topic.trend], trendEn[topic.trend])}
          </p>
          <details className="amp-daily-report-evidence">
            <summary>{t("查看关联原始评论（{count}）", "View source comments ({count})", { count: topic.quotes.length })}</summary>
            {topic.quotes.map((quote, index) => {
              const source = topic.evidence_sources?.[index]
                || report.top_comments.find((item) => item.comment_id === topic.evidence_comment_ids[index]);
              return <blockquote key={`${topic.evidence_comment_ids[index]}:${index}`}>
                “{quote}”
                <small className="amp-daily-report-evidence-source">
                  {source && <>{t("作品：", "Work: ")}{source.item_title || source.item_id} · </>}
                  #{topic.evidence_comment_ids[index]}
                  {source?.share_url && <> · <a href={source.share_url} target="_blank" rel="noopener noreferrer">{t("查看作品", "View work")}</a></>}
                </small>
              </blockquote>;
            })}
          </details>
        </article>)}</div>
      </section>
    </>}
  </div>;
}
