import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AuthProvider } from "../../contexts/auth_context.tsx";
import { I18nProvider } from "../../contexts/i18n_context.tsx";
import CreationContextPanel, { type CreationContextPage } from "./CreationContextPanel.tsx";

function renderContext(page: CreationContextPage, ids: string[] = []) {
  return renderToStaticMarkup(createElement(AuthProvider, null,
    createElement(I18nProvider, null,
      createElement(CreationContextPanel, {
        page, onPageChange: () => {}, insightIds: page === "insights" ? ids : [],
        caseIds: page === "cases" ? ids : [],
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

test("loading references do not display empty-state icons", () => {
  const html = renderContext("insights", ["loading-reference"]);
  assert.match(html, /Loading references/);
  assert.doesNotMatch(html, /data-empty-state-icon=/);
});
