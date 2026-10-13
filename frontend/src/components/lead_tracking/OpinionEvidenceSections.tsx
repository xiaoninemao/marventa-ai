"use client";

import { useEffect, useState } from "react";
import { useI18n } from "@/contexts/i18n_context";
import type { OpinionActionSummary, OpinionDetails, OpinionPost, OpinionStrategy, OpinionVoice } from "@/types/lead_tracking";

type Props = {
  details: OpinionDetails | null;
  loading: boolean;
  error: string;
  onRetry: () => void;
  actions: OpinionActionSummary | null;
  strategy: OpinionStrategy | null;
  strategyBusy: boolean;
  strategyError: string;
};

type Drawer = { kind: "post"; post: OpinionPost } | { kind: "comment"; comment: OpinionVoice };
const number = (value: number | null) => value === null ? "—" : value.toLocaleString();

function StrategyCard({ index, title, description, basis, onCopy }: {
  index: number; title: string; description: string; basis: string; onCopy: () => void;
}) {
  const { t } = useI18n();
  return <article className="amp-opinion-insight-card">
    <div className="amp-opinion-insight-heading"><span>{String(index + 1).padStart(2, "0")}</span><h3>{title}</h3></div>
    <p>{description}</p>
    <div className="amp-opinion-insight-footer"><small>{basis}</small>
      <button type="button" onClick={onCopy}>{t("复制建议 ↗", "Copy advice ↗")}</button></div>
  </article>;
}

export default function OpinionEvidenceSections({ details, loading, error, onRetry,
  actions, strategy, strategyBusy, strategyError }: Props) {
  const { t } = useI18n();
  const [mood, setMood] = useState<"all" | "positive" | "neutral" | "negative">("all");
  const [query, setQuery] = useState("");
  const [drawer, setDrawer] = useState<Drawer | null>(null);
  const [confirmed, setConfirmed] = useState<Set<string>>(() => new Set());
  const [toast, setToast] = useState("");
  const posts = details?.posts || [];
  const comments = details?.comments || [];
  const visibleComments = comments.filter((comment) =>
    (mood === "all" || comment.mood === mood)
    && (!query || `${comment.content} ${comment.topic} ${comment.author}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()))
  );
  const openActions = actions?.actions.filter((action) => !action.completed) || [];

  useEffect(() => {
    if (!drawer) return;
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") setDrawer(null); };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [drawer]);

  async function copyText(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setToast(t("已复制到剪贴板", "Copied to clipboard"));
    } catch {
      setToast(t("复制失败，请手动复制", "Copy failed; please copy manually"));
    }
    window.setTimeout(() => setToast(""), 3000);
  }

  const strategyItems = strategy?.status === "completed"
    ? strategy.recommendations.map((item) => ({
      title: item.title, description: item.next_step,
      basis: `${item.rationale} · ${item.source_dates.join("、")}`,
    }))
    : openActions.slice(0, 3).map((item) => ({
      title: item.topic, description: item.product_suggestion || item.marketing_suggestion,
      basis: `${item.status === "accepted" ? t("待推进优化", "Open improvement") : t("待确认需求", "Unconfirmed need")} · ${item.source_dates.join("、")}`,
    }));
  const strategyPanel = <section className="amp-opinion-strategy-card" aria-labelledby="opinion-strategy-title">
    <div className="amp-opinion-proto-card-head"><h2 id="opinion-strategy-title">{t("AI 策略建议", "AI strategy advice")}</h2>
      {strategy?.status === "completed" ? <span className="amp-opinion-strategy-badge">{t("AI 汇总", "AI summary")}</span>
        : !!strategyItems.length && <span className="amp-opinion-strategy-badge">{t("简报汇总", "Report summary")}</span>}</div>
    <div className="amp-opinion-insight-list">
      {strategyItems.length ? strategyItems.map((item, index) => <StrategyCard key={`${item.title}-${index}`}
        index={index} {...item} onCopy={() => { void copyText(`${item.title}\n${item.description}`); }}/>)
        : <div className="amp-opinion-proto-empty">{strategyBusy ? t("正在生成…", "Generating…") : t("暂无策略建议", "No strategy advice")}</div>}
    </div>
    {strategyError && <p className="amp-opinion-strategy-error" role="alert">{strategyError}</p>}
  </section>;

  function replyDraft(comment: OpinionVoice) {
    return comment.topic
      ? t(`感谢你提出关于「${comment.topic}」的反馈。我们会核对具体情况，确认后再回复。`,
        `Thanks for your feedback about ${comment.topic}. We'll check the details and follow up once confirmed.`)
      : t("感谢你的反馈。我们会核对具体情况，确认后再回复。",
        "Thanks for your feedback. We'll check the details and follow up once confirmed.");
  }

  return <>
    <section className="amp-opinion-proto-section" aria-labelledby="opinion-performance-title">
      <div className="amp-opinion-proto-section-head"><h2 id="opinion-performance-title">{t("推广内容表现", "Promotion content performance")}</h2></div>
      <div className="amp-opinion-post-table-wrap"><table className="amp-opinion-post-table">
        <thead><tr><th>{t("推广内容", "Promotion content")}</th><th>{t("平台", "Platform")}</th>
          <th>{t("曝光量", "Views")}</th><th>{t("互动量", "Engagement")}</th>
          <th>{t("互动率", "Engagement rate")}</th><th>{t("操作", "Action")}</th></tr></thead>
        <tbody>{loading ? <tr><td colSpan={6} className="amp-opinion-proto-empty">{t("加载中…", "Loading…")}</td></tr>
          : error ? <tr><td colSpan={6} className="amp-opinion-proto-empty">{error} <button type="button" onClick={onRetry}>{t("重试", "Retry")}</button></td></tr>
            : posts.length ? posts.map((post, index) => <tr key={post.item_id}>
              <td><div className="amp-opinion-post-name"><span className={`amp-opinion-post-thumb tone-${index % 5}`} aria-hidden="true">{["✧", "⌁", "◎", "▦", "▤"][index % 5]}</span>
                <div><strong>{post.title}</strong><small>{post.published_at ? `${t("发布于", "Published")} ${post.published_at.slice(0, 10)}` : ""}</small></div></div></td>
              <td><span className={`amp-opinion-platform-badge is-${post.platform}`}>
                {post.platform === "douyin" ? t("抖音", "Douyin") : t("小红书", "Xiaohongshu")}</span></td>
              <td><strong>{number(post.views)}</strong></td><td>{number(post.engagement)}</td>
              <td><strong>{post.rate === null ? "—" : `${post.rate.toFixed(2)}%`}</strong>
                {post.rate !== null && <div className="amp-opinion-performance-meter"><b style={{ width: `${Math.min(100, post.rate * 10)}%` }}/></div>}</td>
              <td><button type="button" className="amp-opinion-table-btn" onClick={() => setDrawer({ kind: "post", post })}>{t("分析 →", "Analyze →")}</button></td>
            </tr>) : <tr><td colSpan={6} className="amp-opinion-proto-empty">{t("当前范围暂无推广内容", "No content in this period")}</td></tr>}</tbody>
      </table></div>
    </section>

    <section className="amp-opinion-proto-section" aria-labelledby="opinion-voices-title">
      <div className="amp-opinion-proto-section-head"><h2 id="opinion-voices-title">{t("用户声音与行动建议", "Audience voices and action advice")}</h2></div>
      <div className="amp-opinion-comments-layout"><div className="amp-opinion-voices-card">
        <div className="amp-opinion-comments-toolbar">
          {([[
            "all", t("全部评论", "All comments")], ["positive", t("正向反馈", "Positive")],
            ["neutral", t("一般讨论", "Neutral")], ["negative", t("负向/风险", "Negative / risk")],
          ] as const).map(([key, label]) => <button key={key} type="button" className={`amp-opinion-filter ${mood === key ? "is-active" : ""}`}
            onClick={() => setMood(key)}>{label}</button>)}
          <label className="amp-opinion-searchfield"><span aria-hidden="true">⌕</span>
            <input value={query} onChange={(event) => setQuery(event.target.value)}
              placeholder={t("搜索评论、需求", "Search comments or needs")}
              aria-label={t("搜索评论、需求", "Search comments or needs")}/></label>
        </div>
        <div className="amp-opinion-voice-list">{loading ? <div className="amp-opinion-proto-empty">{t("加载中…", "Loading…")}</div>
          : error ? <div className="amp-opinion-proto-empty">{error}</div>
            : visibleComments.length ? visibleComments.map((comment) => <button type="button" className="amp-opinion-voice" key={comment.comment_id}
              onClick={() => setDrawer({ kind: "comment", comment })}>
              <span className={`amp-opinion-avatar is-${comment.mood}`}>{comment.author.slice(-1)}</span>
              <span className="amp-opinion-voice-main"><span className="amp-opinion-voice-top"><strong>{comment.author}</strong>
                <span className={`amp-opinion-sentiment-tag is-${comment.mood}`}>
                  {comment.review_required ? t("待复核", "Review") : comment.mood === "positive" ? t("正向", "Positive")
                    : comment.mood === "negative" ? t("负向", "Negative") : t("一般", "Neutral")}</span>
                <small>{comment.platform === "douyin" ? t("抖音", "Douyin") : t("小红书", "Xiaohongshu")} · {comment.created_at}</small></span>
                <span className="amp-opinion-voice-content">{comment.content}</span>
                <span className="amp-opinion-voice-footer"><span>♡ {comment.likes}</span><span>▤ {comment.replies}</span>
                  <span># {comment.topic || t("其他", "Other")}</span><em>{t("查看洞察 →", "View insight →")}</em></span>
              </span>
            </button>) : <div className="amp-opinion-proto-empty">{t("没有符合筛选条件的评论", "No matching comments")}</div>}</div>
      </div>{strategyPanel}</div>
    </section>

    {drawer && <div className="amp-opinion-overlay" onMouseDown={(event) => {
      if (event.target === event.currentTarget) setDrawer(null);
    }}><aside className="amp-opinion-drawer" role="dialog" aria-modal="true"
      aria-label={drawer.kind === "post" ? t("推广内容分析", "Content analysis") : t("评论洞察与处理", "Comment insight")}>
      <div className="amp-opinion-drawer-head"><div><small>MARVENTA / MONITOR</small>
        <h2>{drawer.kind === "post" ? t("推广内容分析", "Content analysis") : t("评论洞察与处理", "Comment insight")}</h2></div>
        <button type="button" aria-label={t("关闭", "Close")} onClick={() => setDrawer(null)}>×</button></div>
      {drawer.kind === "post" ? <div className="amp-opinion-drawer-body">
        <span className="amp-opinion-drawer-label">{t("内容标题", "Content title")}</span><div className="amp-opinion-drawer-copy">{drawer.post.title}</div>
        <span className="amp-opinion-drawer-label">{t("表现指标", "Performance")}</span>
        <div className="amp-opinion-drawer-content">{t("曝光量", "Views")}：<b>{number(drawer.post.views)}</b><br/>
          {t("互动量", "Engagement")}：<b>{number(drawer.post.engagement)}</b><br/>
          {t("互动率", "Engagement rate")}：<b>{drawer.post.rate === null ? "—" : `${drawer.post.rate.toFixed(2)}%`}</b><br/>
          {t("平台", "Platform")}：{drawer.post.platform === "douyin" ? t("抖音", "Douyin") : t("小红书", "Xiaohongshu")}</div>
        <span className="amp-opinion-drawer-label">{t("反馈摘要", "Feedback summary")}</span>
        <p className="amp-opinion-drawer-content">{drawer.post.summary || t("暂无相关评论", "No related comments")}</p>
        <span className="amp-opinion-drawer-label">{t("相关评论", "Related comments")}</span>
        <ul className="amp-opinion-drawer-list">{comments.filter((item) => item.item_id === drawer.post.item_id).slice(0, 8)
          .map((item) => <li key={item.comment_id}>{item.content}</li>)}</ul>
        <button type="button" className="amp-opinion-drawer-soft" onClick={() => { void copyText(
          `${drawer.post.title}\n${t("曝光量", "Views")} ${number(drawer.post.views)} / ${t("互动量", "Engagement")} ${number(drawer.post.engagement)} / ${t("互动率", "Rate")} ${drawer.post.rate === null ? "—" : `${drawer.post.rate}%`}\n${drawer.post.summary}`,
        ); }}>{t("复制内容复盘", "Copy content review")}</button>
      </div> : <div className="amp-opinion-drawer-body">
        <span className="amp-opinion-drawer-label">{t("来源", "Source")} / {drawer.comment.platform === "douyin" ? t("抖音", "Douyin") : t("小红书", "Xiaohongshu")} · {drawer.comment.created_at}</span>
        <p className="amp-opinion-drawer-content">{drawer.comment.item_title}</p>
        <span className="amp-opinion-drawer-label">{t("原始评论", "Original comment")}</span>
        <div className="amp-opinion-drawer-copy">{drawer.comment.content}</div>
        <span className="amp-opinion-drawer-label">{t("识别结果", "Analysis")}</span>
        <div className="amp-opinion-drawer-content"><span className={`amp-opinion-sentiment-tag is-${drawer.comment.mood}`}>
          {drawer.comment.review_required ? t("待复核", "Review") : drawer.comment.mood === "positive" ? t("正向评论", "Positive comment")
            : drawer.comment.mood === "negative" ? t("负向评论", "Negative comment") : t("一般讨论", "Neutral comment")}</span>
          <p>{drawer.comment.topic || t("其他", "Other")} {drawer.comment.evidence.length ? `· ${drawer.comment.evidence.join("、")}` : ""}</p></div>
        <span className="amp-opinion-drawer-label">{t("建议回复草稿 · 需人工审核", "Reply draft · review before use")}</span>
        <div className="amp-opinion-drawer-copy">{replyDraft(drawer.comment)}</div>
        <div className="amp-opinion-drawer-actions"><button type="button" className="amp-opinion-generate"
          onClick={() => { void copyText(replyDraft(drawer.comment)); }}>{t("复制回复草稿", "Copy reply draft")}</button>
          <button type="button" className="amp-opinion-export" onClick={() => {
            setConfirmed((current) => new Set(current).add(drawer.comment.comment_id));
            setDrawer(null); setToast(t("本页已标记确认", "Marked confirmed on this page"));
          }}>{confirmed.has(drawer.comment.comment_id) ? t("已标记确认", "Confirmed") : t("人工确认线索", "Confirm lead")}</button></div>
      </div>}
    </aside></div>}
    {toast && <div className="amp-opinion-toast" role="status">{toast}</div>}
  </>;
}
