import assert from "node:assert/strict";
import test from "node:test";
import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { I18nProvider } from "../../contexts/i18n_context.tsx";
import { ToastProvider } from "../../contexts/toast_context.tsx";
import Pagination from "./Pagination.tsx";

const base = {
  pageSize: 12, pageSizeOptions: [6, 12, 24],
  onPageChange: () => {}, onPageSizeChange: () => {},
};

function render(props: ComponentProps<typeof Pagination>) {
  return renderToStaticMarkup(createElement(I18nProvider, null,
    createElement(ToastProvider, null, createElement(Pagination, props)),
  ));
}

test("ordinary pagination retains truthful totals and the shared three-part layout", () => {
  const html = render({ ...base, page: 1, totalItems: 30, totalPages: 3 });
  assert.match(html, /30 total/);
  assert.match(html, /class="amp-pagination-pages"/);
  assert.match(html, /amp-pagination-size/);
  assert.match(html, /aria-current="page"/);
});

test("cursor pagination shows current-page count instead of inventing a total", () => {
  const html = render({ ...base, mode: "cursor", page: 1, pageItems: 12, visitedPages: 1, hasMore: true });
  assert.match(html, /12 on this page/);
  assert.doesNotMatch(html, /12 total/);
  assert.match(html, /class="amp-pagination-number" aria-current="page">1<\/button>/);
  assert.match(html, /class="amp-pagination-number">2<\/button>/);
  assert.doesNotMatch(html, /class="amp-pagination-number">3<\/button>/);
  assert.match(html, /amp-pagination-size/);
});

test("cursor pagination at the end keeps visited pages but blocks an unknown next page", () => {
  const html = render({ ...base, mode: "cursor", page: 3, pageItems: 2, visitedPages: 3, hasMore: false });
  assert.match(html, /2 on this page/);
  assert.match(html, /aria-label="Next page" aria-disabled="true"/);
  assert.doesNotMatch(html, /class="amp-pagination-number">4<\/button>/);
});

test("both empty ordinary lists and empty first cursor pages omit pagination", () => {
  assert.equal(render({ ...base, page: 1, totalItems: 0, totalPages: 1 }), "");
  assert.equal(render({ ...base, mode: "cursor", page: 1, pageItems: 0, visitedPages: 1, hasMore: false }), "");
});
