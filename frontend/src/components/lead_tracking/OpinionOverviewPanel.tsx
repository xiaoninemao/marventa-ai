"use client";

import { useState } from "react";
import { useI18n } from "@/contexts/i18n_context";
import { useToast } from "@/contexts/toast_context";
import InlineIcon from "@/components/redesign/InlineIcon";
import WorkspaceEmptyState from "@/components/redesign/WorkspaceEmptyState";
import type { OpinionOverview, OpinionPerformance, OpinionPerformancePoint } from "@/types/lead_tracking";

type Props = { data: OpinionOverview | null; loading: boolean; error: string;
  onRetry: () => void; performance: OpinionPerformance | null };
const tones: Record<string, string> = { positive: "#4f78ef", neutral: "#52c6ad", negative: "#f3a76b", uncertain: "#adb8cd" };
const moodEn: Record<string, string> = { positive: "Positive", neutral: "Neutral", negative: "Negative", uncertain: "Review" };
const themeEn: Record<string, string> = {
  "采购与试用": "Buying and trials", "报表与数据": "Reports and data", "系统对接": "Integrations",
  "企业配置": "Enterprise setup", "使用体验": "User experience", "上手服务": "Getting started",
};

function formatMetric(value: number | null | undefined, compact = false): string {
  if (value === null || value === undefined) return "—";
  return compact && value >= 10000 ? `${(value / 10000).toFixed(2)}万` : value.toLocaleString("zh-CN");
}

function PerformanceTrend({ performance }: { performance: OpinionPerformance | null }) {
  const { t } = useI18n();
  const [series, setSeries] = useState<"views" | "engagement">("views");
  const points = performance?.daily || [];
  const previousKey: "previous_views" | "previous_engagement" = series === "views" ? "previous_views" : "previous_engagement";
  const width = 760, height = 224, left = 46, right = 13, top = 12, bottom = 12;
  const values = points.flatMap((point) => [point[series], point[previousKey]]).filter((value): value is number => value !== null);
  const max = Math.max(1, ...values);
  const roughStep = max * 1.15 / 4;
  const magnitude = 10 ** Math.floor(Math.log10(roughStep));
  const tickStep = ([1, 1.5, 2, 2.5, 5, 10].find((factor) => factor * magnitude >= roughStep) || 10) * magnitude;
  const ceiling = tickStep * 4;
  const x = (index: number) => left + index * (width - left - right) / Math.max(1, points.length - 1);
  const y = (value: number) => top + (height - top - bottom) * (1 - value / ceiling);
  const pathFor = (key: keyof OpinionPerformancePoint) => points.map((point, index) => {
    const value = point[key];
    if (typeof value !== "number") return "";
    return `${index > 0 && typeof points[index - 1][key] === "number" ? "L" : "M"}${x(index).toFixed(1)},${y(value).toFixed(1)}`;
  }).filter(Boolean).join(" ");
  const currentPath = pathFor(series);
  const priorPath = pathFor(previousKey);
  const areaPath = points.length && points.every((point) => point[series] !== null)
    ? `${currentPath} L${x(points.length - 1).toFixed(1)},${y(0).toFixed(1)} L${x(0).toFixed(1)},${y(0).toFixed(1)} Z`
    : "";
  const label = series === "views" ? t("曝光量", "Exposure") : t("互动量", "Engagement");
  const visibleLabels = points.length > 10 ? new Set([0, ...points.map((_, index) => index).filter((index) => index % 5 === 0), points.length - 1]) : null;
  return <>
    <div className="amp-opinion-card-head"><h2 id="opinion-trend-title">{t("推广表现趋势", "Promotion performance trend")}</h2>
      <div className="amp-opinion-series-tabs" role="group" aria-label={t("趋势指标", "Trend metric")}>
        <button type="button" className={series === "views" ? "is-active" : ""} aria-pressed={series === "views"}
          onClick={() => setSeries("views")}>{t("曝光量", "Exposure")}</button>
        <button type="button" className={series === "engagement" ? "is-active" : ""} aria-pressed={series === "engagement"}
          onClick={() => setSeries("engagement")}>{t("互动量", "Engagement")}</button>
      </div></div>
    {values.length ? <div className="amp-opinion-performance-chart" role="img" aria-label={`${label} ${t("每日走势", "daily trend")}`}>
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden="true">
        <defs><linearGradient id="opinion-trend-fill" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#5d80f3" stopOpacity=".16" /><stop offset="100%" stopColor="#5d80f3" stopOpacity="0" /></linearGradient></defs>
        {[0, .25, .5, .75, 1].map((fraction) => <g key={fraction}>
          <line x1={left} x2={width - right} y1={y(ceiling * fraction)} y2={y(ceiling * fraction)}
            stroke="#e7edf6" strokeDasharray={fraction === 0 ? "0" : "4 6"} />
          <text x={left - 9} y={y(ceiling * fraction) + 4} textAnchor="end" fill="#9ba9be" fontSize="11">{formatMetric(ceiling * fraction)}</text>
        </g>)}
        {areaPath && <path d={areaPath} fill="url(#opinion-trend-fill)" />}
        {priorPath && <path d={priorPath} fill="none" stroke="#67d0c7" strokeWidth="2.5" strokeDasharray="7 5" strokeLinecap="round" />}
        {currentPath && <path d={currentPath} fill="none" stroke="#5d80f3" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />}
        {points.map((point, index) => point[series] === null ? null : <circle key={point.date}
          cx={x(index)} cy={y(point[series]!)} r="3.5" fill="#fff" stroke="#5d80f3" strokeWidth="2.5">
          <title>{`${point.date} · ${label} ${formatMetric(point[series])}`}</title>
        </circle>)}
      </svg>
      <div className="amp-opinion-chart-dates">{points.map((point, index) => <span key={point.date}>
        {visibleLabels && !visibleLabels.has(index) ? "" : point.date.slice(5).replace("-", ".")}</span>)}</div>
    </div> : <p className="amp-opinion-inline-empty" role="status">{t("暂无表现数据", "No performance data")}</p>}
    {values.length > 0 && <div className="amp-opinion-trend-legend"><span><i />{label}</span>
      {priorPath && <span className="is-prior"><i />{t("前期对比", "Previous period")}</span>}</div>}
  </>;
}

function Sentiment({ data }: { data: OpinionOverview }) {
  const { t } = useI18n();
  const stops = data.sentiments.reduce((state, item) => ({
    cursor: state.cursor + item.percent,
    parts: [...state.parts, `${tones[item.key] || "#adb8cd"} ${state.cursor}% ${state.cursor + item.percent}%`],
  }), { cursor: 0, parts: [] as string[] }).parts.join(", ");
  const positive = data.sentiments.find((item) => item.key === "positive")?.percent || 0;
  return <div className="amp-opinion-sentiment-layout">
    <div className="amp-opinion-donut" role="img"
      aria-label={data.sentiments.map((item) => `${t(item.label, moodEn[item.key] || item.label)} ${item.percent}%`).join(", ")
        || t("暂无评论情绪数据", "No comment sentiment data")}
      style={{ background: `conic-gradient(${stops || "#e7edf6 0% 100%"})` }}>
      <div><strong>{data.comments_collected ? `${positive}%` : "—"}</strong><span>{t("正向", "Positive")}</span></div>
    </div>
    {data.sentiments.length > 0 && <div className="amp-opinion-sentiment-legend">{data.sentiments.map((item) => <div key={item.key}>
      <span><i style={{ backgroundColor: tones[item.key] || "#adb8cd" }} />{t(item.label, moodEn[item.key] || item.label)}</span>
      <strong>{item.percent}%</strong>
    </div>)}</div>}
  </div>;
}

function Topics({ data }: { data: OpinionOverview }) {
  const { t } = useI18n();
  const { showError } = useToast();
  const clusters = data.keyword_clusters;
  const maxCount = Math.max(1, ...clusters.map((cluster) => cluster.count));
  async function copyInsights() {
    const lines = clusters.map((cluster) => {
      const label = t(cluster.label, themeEn[cluster.label] || cluster.label);
      return `${label}：${cluster.count} ${t("条评论", "comments")} · ${cluster.keywords.join(" · ")}`;
    });
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
    } catch {
      showError(t("复制失败，请重试。", "Copy failed. Please try again."));
    }
  }
  return <section className="amp-opinion-display-card amp-opinion-topics-card" aria-labelledby="opinion-theme-title">
    <div className="amp-opinion-card-head"><h2 id="opinion-theme-title">{t("用户关注话题", "Audience topics")}</h2>
      {data.theme_status === "ready" && !!clusters.length && <button type="button" className="amp-opinion-topic-copy amp-text-action"
        onClick={() => { void copyInsights(); }}>{t("复制摘要", "Copy summary")}</button>}</div>
    {data.theme_status === "ready" && clusters.length ? <div className="amp-opinion-topic-bars">
      {clusters.map((cluster) => <div className="amp-opinion-topic" key={cluster.key}>
        <div className="amp-opinion-topic-heading"><span>{t(cluster.label, themeEn[cluster.label] || cluster.label)}</span>
          <b>{cluster.count} {t("条评论", "comments")}</b></div>
        <div className="amp-opinion-topic-progress" role="progressbar" aria-valuenow={cluster.count}
          aria-valuemin={0} aria-valuemax={maxCount}
          aria-label={t(cluster.label, themeEn[cluster.label] || cluster.label)}>
          <div style={{ width: `${cluster.count / maxCount * 100}%` }} /></div>
        <div className="amp-opinion-topic-keywords">{cluster.keywords.join(" · ")}</div>
      </div>)}
    </div> : <p className="amp-opinion-inline-empty" role="status">{t("暂无话题", "No topics")}</p>}
  </section>;
}

export default function OpinionOverviewPanel({ data, performance, loading, error, onRetry }: Props) {
  const { t } = useI18n();
  if (loading) return <div className="amp-page-state" role="status">{t("正在汇总评论…", "Loading comment overview…")}</div>;
  if (error) return <div className="amp-page-state" role="alert">{error}
    <button type="button" className="amp-button amp-button-secondary" onClick={onRetry}>{t("重试", "Retry")}</button></div>;
  if (!data) return <WorkspaceEmptyState icon="message" title={t("暂无评论数据", "No comment data")}
    description={t("该时段还没有可用的评论数据。", "No comment data is available for this period.")} />;
  const positive = data.sentiments.find((item) => item.key === "positive")?.percent || 0;
  return <div className="amp-opinion-dashboard">
    <div className="amp-opinion-section-title"><h2>{t("关键监测指标", "Key metrics")}</h2>
      {process.env.NODE_ENV === "development" && data.is_simulated
        && <span className="amp-opinion-demo">{t("本地模拟数据", "Local simulated data")}</span>}</div>
    <section className="amp-opinion-metric-grid" aria-label={t("关键监测指标", "Key metrics")}>
      <div><span>{t("推广内容", "Promotion posts")}</span><InlineIcon name="content" className="amp-opinion-metric-icon" /><strong>{performance ? formatMetric(performance.post_count) : "—"}</strong></div>
      <div><span>{t("累计曝光", "Total exposure")}</span><InlineIcon name="eye" className="amp-opinion-metric-icon" /><strong>{formatMetric(performance?.views, true)}</strong></div>
      <div><span>{t("内容互动", "Content engagement")}</span><InlineIcon name="heart" className="amp-opinion-metric-icon" /><strong>{formatMetric(performance?.engagement)}</strong></div>
      <div><span>{t("正向评论占比", "Positive share")}</span><InlineIcon name="message" className="amp-opinion-metric-icon" /><strong>{data.comments_collected ? `${positive}%` : "—"}</strong></div>
      <div><span>{t("待处置风险", "Risks to review")}</span><InlineIcon name="alert" className="amp-opinion-metric-icon" /><strong>{performance ? formatMetric(performance.risk_count) : "—"}</strong></div>
    </section>
    <div className="amp-opinion-main-grid">
      <section className="amp-opinion-display-card amp-opinion-trend-card" aria-labelledby="opinion-trend-title">
        <PerformanceTrend performance={performance} />
      </section>
      <section className="amp-opinion-display-card" aria-labelledby="opinion-sentiment-title">
        <h2 id="opinion-sentiment-title">{t("评论情绪分布", "Comment sentiment")}</h2><Sentiment data={data} />
      </section>
    </div>
    <div className="amp-opinion-main-grid amp-opinion-bottom-grid is-topics-only">
      <Topics data={data} />
    </div>
  </div>;
}
