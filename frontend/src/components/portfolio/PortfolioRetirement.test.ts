import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

test("portfolio no longer loads report renderers, exports or pending generation polling", () => {
  const overview = readFileSync(new URL("../../app/portfolio/page.tsx", import.meta.url), "utf8");
  const detail = readFileSync(new URL("../../app/portfolio/[scriptId]/page.tsx", import.meta.url), "utf8");
  const css = readFileSync(new URL("../../styles/projects.css", import.meta.url), "utf8");
  assert.doesNotMatch(overview, /PendingDocument|pending-documents|setInterval/);
  assert.doesNotMatch(detail, /portfolio_report|parsePortfolio|hasBilingual|displayWork/);
  assert.doesNotMatch(css, /amp-portfolio-document|amp-portfolio-module-editor|amp-portfolio-edit-section|amp-portfolio-add-module/);
  assert.doesNotMatch(css, /amp-content-card-generating/);
  for (const path of ["../../utils/portfolio_report.ts", "./PortfolioReportDocument.tsx"]) {
    assert.equal(existsSync(new URL(path, import.meta.url)), false);
  }
  assert.match(detail, /: work\}/);
});

test("Content Studio saves native works through the new route without old generation callbacks", () => {
  const client = readFileSync(new URL("../../services/content_generator_api.ts", import.meta.url), "utf8");
  const experience = readFileSync(new URL("../content_generator/ContentGeneratorExperience.tsx", import.meta.url), "utf8");
  const workspace = readFileSync(new URL("../content_generator/AgentDeliverableWorkspace.tsx", import.meta.url), "utf8");
  assert.match(client, /export async function save_creation_work/);
  assert.match(client, /encodeURIComponent\(session_id\)\}\/save-work/);
  assert.match(experience, /onSaveWork=\{handle_save_work\}/);
  assert.match(workspace, /onClick=\{onSaveWork\}/);
  for (const source of [client, experience, workspace]) {
    assert.doesNotMatch(source, /generate_document|generating_doc|onGenerateDocument|generatingDocument/);
  }
});
