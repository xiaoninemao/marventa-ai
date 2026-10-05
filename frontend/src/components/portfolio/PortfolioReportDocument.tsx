import { useId } from "react";
import { translate, type Locale } from "@/i18n/locale";
import type { PortfolioReport } from "@/utils/portfolio_report";

export default function PortfolioReportDocument({ report, locale }: {
  report: PortfolioReport;
  locale: Locale;
}) {
  const titleId = useId();
  return (
    <article className="amp-portfolio-document" lang={locale} aria-labelledby={titleId}>
      <div className="amp-portfolio-document-content">
        <header className="amp-portfolio-document-header">
          <h2 id={titleId}>{report.title}</h2>
        </header>
        <section className="amp-portfolio-document-summary">
          <h3>{translate(locale, "执行摘要", "Executive summary")}</h3>
          <p>{report.summary}</p>
        </section>
        {report.sections.map((section, index) => (
          <section key={`${section.title}-${index}`} className="amp-portfolio-document-section">
            <h3>{section.title}</h3>
            {section.paragraphs.map((paragraph, paragraphIndex) => (
              <p key={paragraphIndex}>{paragraph}</p>
            ))}
          </section>
        ))}
      </div>
    </article>
  );
}
