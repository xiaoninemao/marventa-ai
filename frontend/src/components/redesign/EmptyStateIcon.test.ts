import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import EmptyStateIcon from "./EmptyStateIcon.tsx";

test("semantic empty-state icons are decorative SVGs without a background wrapper", () => {
  for (const name of ["insight", "alert", "file", "search", "case", "history", "listBullet", "collection", "user", "organization"] as const) {
    const html = renderToStaticMarkup(createElement(EmptyStateIcon, { name }));
    assert.match(html, /^<svg /);
    assert.match(html, /aria-hidden="true"/);
    assert.match(html, /focusable="false"/);
    assert.match(html, /class="amp-empty-state-icon"/);
    assert.match(html, new RegExp(`data-empty-state-icon="${name}"`));
    assert.match(html, /<path/);
    assert.doesNotMatch(html, /<span|<div|amp-icon-box|amp-projects-empty-icon|style=/);
  }
});
