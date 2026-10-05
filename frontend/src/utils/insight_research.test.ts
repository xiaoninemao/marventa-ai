import assert from "node:assert/strict";
import test from "node:test";
import { translate, type Translate } from "../i18n/locale.ts";
import type { InsightResearch } from "../types/market_insight.ts";
import { insightSupportsResearch, researchSourceAnchor, researchSourceHref, researchStatusDescription, researchStatusLabel } from "./insight_research.ts";

const t: Translate = (zh, en, values) => translate("en", zh, en, values);
const research = (status: InsightResearch["status"]): InsightResearch => ({
  status, sources: [], claims: [], competitors: [], limitations: [], searched_at: null,
});

test("research states distinguish completion from verification and partial or edited results", () => {
  assert.equal(researchStatusLabel(null, t), "No research evidence");
  assert.equal(researchStatusLabel(research("completed"), t), "Research complete");
  assert.equal(researchStatusLabel(research("partial"), t), "Research incomplete");
  assert.equal(researchStatusLabel(research("unavailable"), t), "External research unavailable");
  assert.equal(researchStatusLabel(research("edited"), t), "Result manually edited");
  assert.match(researchStatusDescription(research("completed"), t), /not independent fact certification/);
  assert.match(researchStatusDescription(research("edited"), t), /do not verify/);
  assert.doesNotMatch(researchStatusDescription(undefined, t), /historical|reanalyzed/i);
});

test("manual insights have no research surface", () => {
  assert.equal(insightSupportsResearch("manual"), false);
  for (const type of ["markdown", "pdf", "docx", "repo"]) assert.equal(insightSupportsResearch(type), true);
});

test("source links allow only HTTP(S) without embedded credentials", () => {
  assert.equal(researchSourceHref("https://example.com/pricing"), "https://example.com/pricing");
  assert.equal(researchSourceHref("http://example.com/docs"), "http://example.com/docs");
  for (const url of [null, "", "javascript:alert(1)", "data:text/html,hello", "file:///etc/passwd", "/relative", "invalid", "https://user:password@example.com"]) {
    assert.equal(researchSourceHref(url), null);
  }
});

test("reference anchors preserve distinct source identifiers without injecting markup", () => {
  assert.equal(researchSourceAnchor("source/1"), "insight-research-source-source%2F1");
  assert.notEqual(researchSourceAnchor("source/1"), researchSourceAnchor("source%2F1"));
});
