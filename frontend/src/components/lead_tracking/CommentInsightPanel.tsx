"use client";

import { useI18n } from "@/contexts/i18n_context";
import WorkspaceEmptyState from "@/components/redesign/WorkspaceEmptyState";
import InlineIcon from "@/components/redesign/InlineIcon";
import type { LeadTrackingCommentInsight } from "@/types/lead_tracking";

export default function CommentInsightPanel({ data, loading, error, onRetry }: {
  data: LeadTrackingCommentInsight | null;
  loading: boolean;
  error: string;
  onRetry: () => void;
}) {
  const { t, locale } = useI18n();
  if (loading) return <div className="amp-page-state" role="status">{t("评论洞察加载中…", "Loading comment insights…")}</div>;
  if (error) return <div className="amp-projects-state" role="alert"><strong>{error}</strong>
    <button type="button" className="amp-button amp-button-secondary" onClick={onRetry}>{t("重试", "Retry")}</button></div>;
  if (!data || data.status === "unavailable") return <WorkspaceEmptyState icon="message"
    title={t("暂无评论快照", "No comment snapshot")}
    description={t("同步未启用、权限未满足，或尚未完成首次每日汇总。",
      "Sync is disabled, permission is missing, or the first daily snapshot has not completed.")} />;
  if (data.status === "failed") return <div className="amp-projects-state" role="alert">
    <strong>{t("评论同步失败", "Comment sync failed")}</strong>
    <p>{t("最近一次每日汇总未完成，请检查账号授权和同步服务。", "The latest daily snapshot did not complete. Check account authorization and the sync service.")}</p>
    <button type="button" className="amp-button amp-button-secondary" onClick={onRetry}>{t("重试", "Retry")}</button>
  </div>;
  if (!data.items.length) return <WorkspaceEmptyState icon="message"
    title={t("前一日暂无可访问评论", "No accessible comments for the previous day")}
    description={t("同步已完成，但当前快照中没有可展示的评论。", "Sync completed, but this snapshot contains no displayable comments.")} />;

  return (
    <>
      <div className="amp-lead-comment-summary" role="status">
        {data.is_simulated && <span className="amp-badge amp-badge-muted">{t("模拟数据", "Demo data")}</span>}
        <span>{t("{date} · Top {count}", "{date} · Top {count}", { date: data.date, count: data.top_limit })}</span>
        <span>{data.timezone}</span>
        {data.last_synced_at && <time dateTime={data.last_synced_at}>
          {t("同步于 {time}", "Synced {time}", { time: new Date(data.last_synced_at).toLocaleString(locale) })}
        </time>}
      </div>
      {data.status === "partial" && <p role="alert" className="amp-publication-copy-save-error">
        {t("本次汇总未覆盖全部可访问评论，以下为已获取数据中的 Top 50。",
          "This snapshot did not cover every accessible comment. The list is the Top 50 from retrieved data.")}
      </p>}
      <ol className="amp-lead-comment-list" aria-label={t("高互动评论 Top 50", "Top 50 high-engagement comments")}>
        {data.items.map((comment, index) => (
          <li key={`${comment.item_id}:${comment.comment_id}`} className="amp-lead-comment-row">
            <span className="amp-lead-comment-rank">{index + 1}</span>
            <div className="amp-lead-comment-copy">
              <p>{comment.content || t("评论正文不可用", "Comment text unavailable")}</p>
              <span>{t("评论用户 {id}", "Commenter {id}", { id: comment.comment_user_id || "—" })}</span>
            </div>
            <dl className="amp-lead-comment-metrics">
              <div><dt><InlineIcon name="heart" />{t("点赞", "Likes")}</dt><dd>{comment.digg_count.toLocaleString(locale)}</dd></div>
              <div><dt><InlineIcon name="message" />{t("回复", "Replies")}</dt><dd>{comment.reply_comment_total.toLocaleString(locale)}</dd></div>
            </dl>
            <time dateTime={new Date(comment.create_time * 1000).toISOString()}>
              {new Date(comment.create_time * 1000).toLocaleString(locale)}
            </time>
          </li>
        ))}
      </ol>
    </>
  );
}
