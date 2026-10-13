"use client";

import { useI18n } from "@/contexts/i18n_context";
import { useEffect, useRef, useState } from "react";
import InlineIcon from "@/components/redesign/InlineIcon";
import { GuardedButton } from "@/components/redesign/GuardedControls";
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
const reviewReasons: Record<string, [string, string]> = {
  sarcasm: ["疑似反讽，无法仅凭字面判断真实态度", "Possible sarcasm; literal wording may not reflect the person's view"],
  conflicting_negation: ["同一句含有相反的否定表达，需人工判断", "Conflicting negations need human review"],
  multiple_topics: ["同一句涉及多个方面，单一观点不能套用于所有方面", "Several aspects appear in one comment; one stance cannot safely cover all of them"],
  model_conflict: ["模型判断与否定表达冲突，需人工判断", "The model conflicts with a negation in the comment"],
  low_confidence: ["模型把握不足，需人工判断", "Model confidence is too low"],
  rules_only: ["当前仅用关键词规则识别，需人工复核", "Only keyword rules are available; human review is needed"],
};

export default function DailyReportPanel({
  report, dates, date, selectedWorkId, loading, error, busyComment, onDate, onRetry, onDownload, onReviewComment,
}: {
  report: DailyCommentReport | null;
  dates: string[];
  date: string;
  selectedWorkId: string;
  loading: boolean;
  error: string;
  busyComment: string;
  onDate: (date: string) => void;
  onRetry: () => void;
  onDownload: (format: "md" | "json") => void;
  onReviewComment: (commentId: string, stance: "support" | "oppose" | "neutral" | "uncertain") => void;
}) {
  const { t } = useI18n();
  const [stanceEdits, setStanceEdits] = useState<Record<string, "support" | "oppose" | "neutral" | "uncertain">>({});
  const [showAllComments, setShowAllComments] = useState(false);
  const exportMenuRef = useRef<HTMLDetailsElement>(null);
  const workAnalyses = report?.work_analyses || [];
  const selectedWork = workAnalyses.find((work) => work.item_id === selectedWorkId);
  const activeTopics = selectedWorkId ? selectedWork?.topics || [] : report?.topics || [];
  const allComments = workAnalyses.length
    ? workAnalyses.flatMap((work) => work.comments).sort((left, right) =>
      right.interaction_score - left.interaction_score || right.create_time - left.create_time
      || left.comment_id.localeCompare(right.comment_id))
    : report?.top_comments || [];
  const activeComments = selectedWorkId ? selectedWork?.comments || [] : allComments;

  useEffect(() => {
    setShowAllComments(false);
  }, [date, selectedWorkId]);

  useEffect(() => {
    function closeOnOutsidePointer(event: PointerEvent) {
      const menu = exportMenuRef.current;
      if (menu?.open && !menu.contains(event.target as Node)) menu.open = false;
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape" && exportMenuRef.current?.open) exportMenuRef.current.open = false;
    }
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, []);

  return <div className="amp-daily-report">
    <div className="amp-daily-report-toolbar">
      <div className="amp-daily-report-date-control">
        <label>{t("日报日期", "Report date")}
          <select value={date} onChange={(event) => onDate(event.target.value)}>
            {(dates.includes(date) ? dates : [date, ...dates]).map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
        </label>
        <button type="button" className="amp-daily-report-refresh"
          aria-label={t("刷新简报", "Refresh report")} title={t("刷新简报", "Refresh report")} onClick={onRetry}>
          <InlineIcon name="refresh" />
        </button>
      </div>
      {report && ["completed", "partial"].includes(report.status) && <>
        <a className="amp-button amp-button-secondary" href="#daily-report-work-comments">{t("产品评论", "Product comments")}</a>
        {(!selectedWorkId || selectedWork) && <details ref={exportMenuRef} className="amp-daily-report-export">
          <summary className="amp-button amp-button-secondary">{t("导出简报", "Export report")}</summary>
          <div className="amp-daily-report-export-menu">
            <button type="button" onClick={(event) => {
              event.currentTarget.closest("details")?.removeAttribute("open");
              onDownload("md");
            }}>{t("Markdown 格式 (.md)", "Markdown format (.md)")}</button>
            <button type="button" onClick={(event) => {
              event.currentTarget.closest("details")?.removeAttribute("open");
              onDownload("json");
            }}>{t("JSON 格式 (.json)", "JSON format (.json)")}</button>
          </div>
        </details>}
      </>}
    </div>
    {loading && <p role="status">{t("正在加载每日简报…", "Loading daily report…")}</p>}
    {error && <p role="alert">{error}</p>}
    {!loading && !error && (!report || report.status === "unavailable" || report.status === "failed") &&
      <div className="amp-daily-report-empty" role="status">
        <strong>{t("暂无可用的真实评论简报", "No verified comment report available")}</strong>
        <p>{report?.message || t("等待授权账号完成每日评论同步。", "Waiting for the authorized account's daily comment sync.")}</p>
      </div>}
    {!loading && !error && report && ["completed", "partial"].includes(report.status) && <>
      {process.env.NODE_ENV === "development" && report.is_simulated && <div className="amp-daily-report-note" role="status">
        <strong>{t("本地模拟数据 · 仅供功能预览", "Local simulated data · preview only")}</strong>
        <span>{t("评论、用户和作品均为虚构，不代表真实平台舆情；本次不会发送正式日报通知。", "Comments, users and works are fictional and do not represent real platform opinion. No official report notification is sent.")}</span>
      </div>}
      {process.env.NODE_ENV === "development" && report.is_simulated && <div className="amp-daily-report-note">
        <strong>{t("模拟评论快照", "Simulated comment snapshot")}</strong>
        <span>{t("虚构样本用于体验排序与分析流程；互动量不代表真实需求普遍性。", "Fictional samples demonstrate ranking and analysis. Engagement does not establish real-world demand.")}</span>
        <span>{report.semantic_status === "fine_tuned_bert"
          ? t("已使用经验证的语义模型；不确定结果待人工复核。", "Validated semantic model used; uncertain results await review.")
          : t("语义模型尚未启用或不可用；规则识别结果均待人工复核。", "Semantic model unavailable; rule-based signals all await human review.")}</span>
      </div>}
      <section id="daily-report-opinion">
        <h2>{t("反馈分析", "Feedback analysis")}</h2>
        {activeTopics.length === 0 && <p>{t("暂无可归纳的评论。", "No comments to summarize yet.")}</p>}
        <div className="amp-daily-report-list">{activeTopics.map((topic) => <article key={topic.topic}>
          <div className="amp-daily-report-topic-heading"><h3>{topic.topic}</h3>
            {!selectedWorkId && <span>{t(levelZh[topic.evidence_level], levelEn[topic.evidence_level])}</span>}</div>
          {topic.conclusion && <p><strong>{t("归纳结论：", "Summary: ")}</strong>{topic.conclusion}</p>}
          <p><strong>{t("产品建议：", "Product suggestion: ")}</strong>{topic.product_suggestion}</p>
          <p><strong>{t("营销建议：", "Marketing suggestion: ")}</strong>{topic.marketing_suggestion}</p>
          <p className="amp-daily-report-meta">
            {t("支持", "Support")} {topic.supporting_comments} · {t("反对", "Oppose")} {topic.opposing_comments} · {t("中立或不确定", "Neutral or uncertain")} {topic.neutral_comments} · {t("不同用户", "Distinct users")} {topic.distinct_users}
            {!selectedWorkId && <> · {t("作品", "Works")} {topic.works} · {t(trendZh[topic.trend], trendEn[topic.trend])}</>}
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
      <section id="daily-report-work-comments">
        <h2>{t("核心评论（按互动量排序）", "Featured comments (by engagement)")}</h2>
        {activeComments.length === 0 && <p>{t("该范围内暂无已采集评论。", "No collected comments in this scope.")}</p>}
        {activeComments.length > 0 && <>
          <div className="amp-daily-report-list">{(showAllComments ? activeComments : activeComments.slice(0, 10)).map((item) => <article key={item.comment_id}>
          <p>{item.content}</p>
          <div className="amp-daily-report-meta">
            <span>{t("作品：", "Work: ")}{item.item_title || item.item_id}</span>
            <span>{t("点赞", "Likes")} {item.digg_count} · {t("回复", "Replies")} {item.reply_comment_total}</span>
            <span>{item.reviewed ? t("已人工确认", "Manually reviewed")
              : item.pending_review ? t("待人工复核", "Needs review") : t("模型已识别", "Classified")}</span>
            {item.share_url && <a href={item.share_url} target="_blank" rel="noopener noreferrer">{t("查看作品来源", "View source work")}</a>}
          </div>
          {!item.reviewed && item.review_reason && <p className="amp-daily-report-meta">
            {t("待复核原因：", "Review reason: ")}
            {t(...(reviewReasons[item.review_reason] || [item.review_reason, item.review_reason]))}
          </p>}
          <div className="amp-daily-report-review">
            <label>{t("观点", "Stance")}
              <select value={stanceEdits[item.comment_id] || item.stance}
                onChange={(event) => setStanceEdits((current) => ({
                  ...current, [item.comment_id]: event.target.value as "support" | "oppose" | "neutral" | "uncertain",
                }))}>
                <option value="support">{t("提出问题或支持改进", "Raises an issue or supports change")}</option>
                <option value="oppose">{t("反对改动", "Opposes change")}</option>
                <option value="neutral">{t("中立／咨询", "Neutral or inquiry")}</option>
                <option value="uncertain">{t("暂不确定，继续观察", "Uncertain; keep observing")}</option>
              </select>
            </label>
            <GuardedButton type="button" disabled={busyComment === item.comment_id
              || (item.reviewed && (stanceEdits[item.comment_id] ?? item.stance) === item.stance)}
              blockedReason={busyComment === item.comment_id
                ? t("正在保存，请稍候。", "Saving, please wait.")
                : t("判断没有变化。", "The judgment has not changed.")}
              onClick={() => onReviewComment(item.comment_id, stanceEdits[item.comment_id] || item.stance)}>
              {item.reviewed ? t("保存修改", "Save") : t("确认判断", "Confirm")}
            </GuardedButton>
          </div>
          </article>)}</div>
          {activeComments.length > 10 && <button type="button" className="amp-daily-report-show-all"
            onClick={() => setShowAllComments((value) => !value)}>
            {showAllComments ? t("收起评论", "Show fewer comments")
              : t("查看全部评论（{count}）", "View all comments ({count})", { count: activeComments.length })}
          </button>}
        </>}
      </section>
    </>}
  </div>;
}
