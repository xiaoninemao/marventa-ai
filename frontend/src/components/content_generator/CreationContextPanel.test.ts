import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AuthProvider } from "../../contexts/auth_context.tsx";
import { I18nProvider } from "../../contexts/i18n_context.tsx";
import CreationContextPanel, { loadMaterialReferences, type CreationContextPage } from "./CreationContextPanel.tsx";
import type { ProjectMaterial } from "../../types/publishing.ts";
import type { CreationPlan } from "../../types/content_generator.ts";

function renderContext(page: CreationContextPage, ids: string[] = [], plans: CreationPlan[] = []) {
  return renderToStaticMarkup(createElement(AuthProvider, null,
    createElement(I18nProvider, null,
      createElement(CreationContextPanel, {
        page, onPageChange: () => {}, insightIds: page === "insights" ? ids : [],
        caseIds: page === "cases" ? ids : [],
        projectId: "project", materialIds: page === "materials" ? ids : [],
        plans,
      }),
    ),
  ));
}

test("unselected reference panels use the matching insight or case icon", () => {
  const insight = renderContext("insights");
  assert.match(insight, /No market insights selected/);
  assert.match(insight, /data-empty-state-icon="insight"/);
  assert.doesNotMatch(insight, /data-empty-state-icon="case"/);
  const cases = renderContext("cases");
  assert.match(cases, /No cases selected/);
  assert.match(cases, /data-empty-state-icon="case"/);
  assert.doesNotMatch(cases, /data-empty-state-icon="insight"/);
});

test("material context has its own tab, count and empty state", () => {
  const empty = renderContext("materials");
  assert.match(empty, /No materials selected/);
  assert.match(empty, /class="amp-empty-state-icon"/);
  assert.match(empty, /data-empty-state-icon="collection"/);
  assert.doesNotMatch(empty, /No market insights selected|No cases selected/);
  const populated = renderContext("materials", ["material-1", "material-2"]);
  assert.match(populated, /Materials<\/span><small>2<\/small>/);
  assert.match(populated, /Loading\.\.\./);
  assert.doesNotMatch(populated, /No insight summary/);
});

test("plans sit after materials and display intermediate results", () => {
  const empty = renderContext("plans");
  assert.match(empty, /No plans yet/);
  assert.ok(empty.indexOf("Materials") < empty.indexOf(">Plans<"));
  const html = renderToStaticMarkup(createElement(AuthProvider, null,
    createElement(I18nProvider, null, createElement(CreationContextPanel, {
      page: "plans", onPageChange: () => {}, insightIds: [], caseIds: [],
      plans: [{ id: "plan", title: "Launch plan", content: "Audience and execution steps", created_at: "2026-10-08" }],
    })),
  ));
  assert.match(html, /Launch plan/);
  assert.match(html, /Audience and execution steps/);
});

test("plans use reference cards and keep their full machine-readable source untouched", () => {
  const content = "Plan source\n\n{\"handoff\":\"Keep <script> & all fields\"}\n  Indented line";
  const plans: CreationPlan[] = [{
    id: "plan-raw", title: "A long routing objective ".repeat(12), content, created_at: "2026-10-09T00:00:00Z",
  }];
  const before = JSON.stringify(plans);
  const html = renderContext("plans", [], plans);
  assert.match(html, /amp-reference-card-grid amp-creation-plans/);
  assert.match(html, /amp-reference-insight-card-selected amp-creation-plan-card/);
  assert.match(html, /<summary aria-label="View creation plan 1">/);
  assert.match(html, /<time dateTime="2026-10-09T00:00:00Z">/i);
  assert.match(html, /<pre[^>]*tabindex="0"[^>]*>Plan source\n\n/);
  assert.match(html, /&lt;script&gt; &amp; all fields/);
  assert.match(html, /\n  Indented line<\/pre>/);
  assert.doesNotMatch(html, /<script>|<textarea|<input/);
  assert.doesNotMatch(html, /amp-creation-plan-preview/);
  assert.doesNotMatch(html, /<details[^>]*\sopen(?:=|>)/);
  assert.equal(JSON.stringify(plans), before);
});

test("plan cards show newest first, retain stable numbering and expose unavailable metadata", () => {
  const html = renderContext("plans", [], [
    { id: "first", title: "First plan", content: "Original", created_at: "2026-10-08" },
    { id: "second", title: "", content: "New", created_at: "not-a-time" },
  ]);
  assert.ok(html.indexOf('data-plan-id="second"') < html.indexOf('data-plan-id="first"'));
  assert.match(html, /View creation plan 2/);
  assert.match(html, /View creation plan 1/);
  assert.match(html, /Untitled plan/);
  assert.match(html, /Creation time unavailable/);
});

test("saved materials load only same-project files and retain missing placeholders", async (context) => {
  const requests: string[] = [];
  const material = (id: string, project_id = "project", node_type: "collection" | "file" = "file") =>
    ({ id, project_id, node_type, name: id, media_type: "image", file_url: `/files/${id}` }) as ProjectMaterial;
  context.mock.method(globalThis, "fetch", async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    requests.push(url.pathname + url.search);
    return Response.json({ success: true, data: url.searchParams.get("material_set_id")
      ? [material("saved"), material("unselected"), material("other-project", "other")]
      : [material("collection", "project", "collection"), material("foreign-collection", "other", "collection")] });
  });
  const items = await loadMaterialReferences("project", ["saved", "deleted", "other-project", "collection"]);
  assert.deepEqual(items.map((item) => [item.id, item.material?.name]), [
    ["saved", "saved"], ["deleted", undefined], ["other-project", undefined], ["collection", undefined],
  ]);
  assert.equal(requests.length, 2);
  assert.match(requests[1], /material_set_id=collection/);
});

test("material reference failures remain retryable rather than becoming empty insights", async (context) => {
  let failed = true;
  context.mock.method(globalThis, "fetch", async () => failed
    ? Response.json({ detail: "Could not load project materials" }, { status: 503 })
    : Response.json({ success: true, data: [] }));
  await assert.rejects(loadMaterialReferences("project", ["saved"]), /Could not load project materials/);
  failed = false;
  assert.deepEqual(await loadMaterialReferences("project", ["saved"]), [{ id: "saved", material: undefined }]);
});

test("missing historical project scope does not fetch material references", async (context) => {
  const fetch = context.mock.method(globalThis, "fetch", async () => { throw new Error("Unexpected fetch"); });
  assert.deepEqual(await loadMaterialReferences("", ["saved"]), [{ id: "saved" }]);
  assert.equal(fetch.mock.callCount(), 0);
});

test("loading references do not display empty-state icons", () => {
  const html = renderContext("insights", ["loading-reference"]);
  assert.match(html, /Loading\.\.\./);
  assert.doesNotMatch(html, /data-empty-state-icon=/);
});
