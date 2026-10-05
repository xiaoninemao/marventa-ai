import type { Locale, Translate } from "@/i18n/locale";
import type { InsightResearch, ResearchSource } from "@/types/market_insight";
import InlineIcon from "@/components/redesign/InlineIcon";
import { researchSourceAnchor, researchSourceHref, researchStatusDescription, researchStatusLabel } from "@/utils/insight_research";

function SourceReferences({ ids, sources, t }: { ids: string[]; sources: ResearchSource[]; t: Translate }) {
  if (ids.length === 0) {
    return <p className="amp-insight-research-muted">{t("未提供支持来源", "No supporting source supplied")}</p>;
  }
  return (
    <ul className="amp-insight-research-references" aria-label={t("支持来源", "Supporting sources")}>
      {ids.map((id) => {
        const source = sources.find((item) => item.id === id);
        return <li key={id}>{source
          ? <a href={`#${researchSourceAnchor(id)}`}>{source.title}</a>
          : <span>{t("引用来源缺失", "Referenced source is missing")}</span>}</li>;
      })}
    </ul>
  );
}

function ResearchTime({ value, locale }: { value: string; locale: Locale }) {
  const date = new Date(value);
  return <time dateTime={value}>{Number.isNaN(date.getTime()) ? value : date.toLocaleString(locale)}</time>;
}

export default function InsightResearchPanel({ research, locale, t }: {
  research?: InsightResearch | null;
  locale: Locale;
  t: Translate;
}) {
  const hasEvidence = !!research && (
    research.sources.length > 0 || research.claims.length > 0 || research.competitors.length > 0
  );
  return (
    <section className={`amp-insight-research${hasEvidence ? "" : " amp-insight-research-empty"}`} aria-labelledby="insight-research-title">
      {hasEvidence ? (
        <header className="amp-insight-research-header">
          <div>
            <h2 id="insight-research-title">{t("研究证据", "Research evidence")}</h2>
            <p>{researchStatusDescription(research, t)}</p>
          </div>
          <div className="amp-insight-research-status">
            <span>{researchStatusLabel(research, t)}</span>
            {research?.searched_at && <ResearchTime value={research.searched_at} locale={locale} />}
          </div>
        </header>
      ) : (
        <div className="amp-insight-research-empty-content">
          <span className="amp-insight-research-empty-icon" aria-hidden="true"><InlineIcon name="insight" /></span>
          <h2 id="insight-research-title">{t("暂无研究证据", "No research evidence")}</h2>
          <p>{researchStatusDescription(research, t)}</p>
        </div>
      )}

      {!!research?.limitations.length && (
        <section className="amp-insight-research-limitations" aria-labelledby="insight-research-limitations-title">
          <h3 id="insight-research-limitations-title">{t("研究限制", "Research limitations")}</h3>
          <ul>{research.limitations.map((item, index) => <li key={`${index}-${item}`}>{item}</li>)}</ul>
        </section>
      )}

      {!!research?.competitors.length && (
        <section className="amp-insight-research-section" aria-labelledby="insight-research-competitors-title">
          <h3 id="insight-research-competitors-title">{t("竞品对比", "Competitor comparison")}</h3>
          <div className="amp-insight-research-items">
            {research.competitors.map((competitor, index) => (
              <article key={`${index}-${competitor.name}`}>
                <h4>{competitor.name}</h4>
                <p>{competitor.comparison}</p>
                <SourceReferences ids={competitor.source_ids} sources={research.sources} t={t} />
              </article>
            ))}
          </div>
        </section>
      )}

      {!!research?.claims.length && (
        <section className="amp-insight-research-section" aria-labelledby="insight-research-claims-title">
          <h3 id="insight-research-claims-title">{t("事实依据与分析推断", "Evidence and analytical inferences")}</h3>
          <div className="amp-insight-research-items">
            {research.claims.map((claim) => (
              <article key={claim.id}>
                <span className="amp-insight-research-kind">{claim.kind === "fact"
                  ? t("资料陈述", "Source statement") : t("分析推断", "Analytical inference")}</span>
                <p>{claim.text}</p>
                {claim.quote && <blockquote>{claim.quote}</blockquote>}
                <SourceReferences ids={claim.source_ids} sources={research.sources} t={t} />
              </article>
            ))}
          </div>
        </section>
      )}

      {!!research?.sources.length && (
        <section className="amp-insight-research-section" aria-labelledby="insight-research-sources-title">
          <h3 id="insight-research-sources-title">{t("研究来源", "Research sources")}</h3>
          <div className="amp-insight-research-items">
            {research.sources.map((source) => {
              const href = researchSourceHref(source.url);
              return (
                <article key={source.id} id={researchSourceAnchor(source.id)} tabIndex={-1}>
                  <h4>{href
                    ? <a href={href} target="_blank" rel="noopener noreferrer">{source.title}</a>
                    : source.title}</h4>
                  <p className="amp-insight-research-muted">
                    {source.kind === "document" ? t("输入资料", "Input material") : t("网页资料", "Web source")}
                    {source.retrieved_at && <> · <ResearchTime value={source.retrieved_at} locale={locale} /></>}
                  </p>
                  {source.url && !href && <p className="amp-insight-research-muted">
                    {t("来源链接无效，无法打开。", "The source link is invalid and cannot be opened.")}
                  </p>}
                  {source.excerpt && <details>
                    <summary>{t("查看原文", "View excerpt")}</summary>
                    <blockquote>{source.excerpt}</blockquote>
                  </details>}
                </article>
              );
            })}
          </div>
        </section>
      )}
    </section>
  );
}
