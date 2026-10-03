import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { I18nProvider } from "../../contexts/i18n_context.tsx";
import type { PortfolioReport } from "../../utils/portfolio_report.ts";
import PortfolioReportDocument from "./PortfolioReportDocument.tsx";

const report: PortfolioReport = {
  title: "完整营销报告",
  date: "2026-10-03",
  summary: "执行摘要保持原样。\n第二行摘要。",
  sections: [
    { title: "目标受众", paragraphs: ["第一段原文。", "第二段原文。\n  1. 保留编号与缩进"] },
    { title: "内容策略", paragraphs: ["<script>只是文本</script>", "最终段落。"] },
  ],
};

test("reports render as one continuous document with title and ordered chapters", () => {
  const before = structuredClone(report);
  const html = renderToStaticMarkup(createElement(PortfolioReportDocument, { report, locale: "zh-CN" }));
  assert.match(html, /^<article /);
  assert.match(html, /lang="zh-CN"/);
  assert.match(html, /aria-labelledby=/);
  assert.match(html, /<h2[^>]*>完整营销报告<\/h2>/);
  assert.match(html, /<h3>执行摘要<\/h3>/);
  assert.equal((html.match(/<h3>/g) || []).length, 3);
  assert.ok(html.indexOf("目标受众") < html.indexOf("内容策略"));
  assert.ok(html.indexOf("第一段原文") < html.indexOf("第二段原文"));
  assert.doesNotMatch(html, /amp-insight-detail-card|amp-portfolio-report-grid|amp-portfolio-report-section/);
  assert.deepEqual(report, before);
});

test("all paragraphs preserve their contents and markup remains escaped", () => {
  const html = renderToStaticMarkup(createElement(PortfolioReportDocument, { report, locale: "zh-CN" }));
  assert.match(html, /执行摘要保持原样。\n第二行摘要。/);
  assert.match(html, /第二段原文。\n  1\. 保留编号与缩进/);
  assert.match(html, /&lt;script&gt;只是文本&lt;\/script&gt;/);
  assert.match(html, /最终段落。/);
  assert.doesNotMatch(html, /<script>/);
});

test("summary-only reports and English labels remain supported", () => {
  const html = renderToStaticMarkup(createElement(PortfolioReportDocument, {
    report: { title: "Marketing report", date: "", summary: "Summary only.", sections: [] },
    locale: "en",
  }));
  assert.match(html, /lang="en"/);
  assert.match(html, /<h3>Executive summary<\/h3>/);
  assert.match(html, /Summary only\./);
  assert.equal((html.match(/<section /g) || []).length, 1);
});

test("Chinese report headings remain Chinese in the default English interface", () => {
  const html = renderToStaticMarkup(createElement(I18nProvider, null,
    createElement(PortfolioReportDocument, { report, locale: "zh-CN" }),
  ));
  assert.match(html, /<h3>执行摘要<\/h3>/);
  assert.doesNotMatch(html, /Executive summary/);
});
