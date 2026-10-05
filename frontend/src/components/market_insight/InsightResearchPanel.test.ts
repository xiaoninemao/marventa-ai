import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { translate, type Translate } from "../../i18n/locale.ts";
import type { InsightResearch } from "../../types/market_insight.ts";
import InsightResearchPanel from "./InsightResearchPanel.tsx";

const t: Translate = (zh, en, values) => translate("en", zh, en, values);
const research: InsightResearch = {
  status: "partial",
  searched_at: "2026-10-02T09:00:00Z",
  limitations: ["Pricing could not be retrieved."],
  sources: [
    { id: "doc", title: "Uploaded product document", url: null, kind: "document", retrieved_at: "", excerpt: "Supports team workspaces." },
    { id: "web", title: "Competitor documentation", url: "https://example.com/docs", kind: "web", retrieved_at: "2026-10-02T09:00:00Z", excerpt: "Public documentation excerpt." },
  ],
  claims: [
    { id: "fact", text: "The document describes team workspaces.", kind: "fact", source_ids: ["doc"], quote: "Supports team workspaces." },
    { id: "inference", text: "Teams may benefit.", kind: "inference", source_ids: ["doc"], quote: "" },
  ],
  competitors: [{ name: "Comparable product", comparison: "Offers a related workflow.", source_ids: ["web"] }],
};

test("research panel renders evidence, limitations, competitors and traceable safe references", () => {
  const html = renderToStaticMarkup(createElement(InsightResearchPanel, { research, locale: "en", t }));
  assert.match(html, /Research incomplete/);
  assert.match(html, /Pricing could not be retrieved/);
  assert.match(html, /Comparable product/);
  assert.match(html, /Source statement/);
  assert.match(html, /Analytical inference/);
  assert.match(html, /<blockquote>Supports team workspaces\.<\/blockquote>/);
  assert.match(html, /href="#insight-research-source-doc"/);
  assert.match(html, /id="insight-research-source-doc"/);
  assert.match(html, /href="https:\/\/example.com\/docs" target="_blank" rel="noopener noreferrer"/);
  assert.doesNotMatch(html, /Verified fact/);
});

test("legacy results and edited results never claim external verification", () => {
  const legacy = renderToStaticMarkup(createElement(InsightResearchPanel, { locale: "en", t }));
  assert.match(legacy, /No research evidence/);
  assert.match(legacy, /amp-insight-research-empty-content/);
  assert.doesNotMatch(legacy, /historical|reanalyzed/i);
  assert.doesNotMatch(legacy, /Research complete/);
  const edited = renderToStaticMarkup(createElement(InsightResearchPanel, {
    research: { ...research, status: "edited" }, locale: "en", t,
  }));
  assert.match(edited, /Result manually edited/);
  assert.match(edited, /do not verify the current content/);
});

test("invalid links, absent references and markup in source text stay explicit and safe", () => {
  const html = renderToStaticMarkup(createElement(InsightResearchPanel, {
    research: {
      ...research,
      sources: [{ ...research.sources[0], title: "<script>test</script>", url: "javascript:alert(1)" }],
      claims: [{ ...research.claims[0], source_ids: ["missing"] }],
    },
    locale: "en", t,
  }));
  assert.match(html, /Referenced source is missing/);
  assert.match(html, /source link is invalid/);
  assert.match(html, /&lt;script&gt;test&lt;\/script&gt;/);
  assert.doesNotMatch(html, /href="javascript:/);
  assert.doesNotMatch(html, /<script>/);
});

test("Chinese research view uses localized labels", () => {
  const zh: Translate = (chinese, english, values) => translate("zh-CN", chinese, english, values);
  const html = renderToStaticMarkup(createElement(InsightResearchPanel, { research, locale: "zh-CN", t: zh }));
  assert.match(html, /研究不完整/);
  assert.match(html, /资料陈述/);
  assert.match(html, /研究限制/);
});
