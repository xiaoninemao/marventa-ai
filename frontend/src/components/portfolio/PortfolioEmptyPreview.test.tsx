import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import PortfolioEmptyPreview from "./PortfolioEmptyPreview";

test("portfolio image and video empty covers use distinct finished-work frames rather than creation layers", () => {
  const image = renderToStaticMarkup(createElement(PortfolioEmptyPreview, { kind: "image" }));
  const video = renderToStaticMarkup(createElement(PortfolioEmptyPreview, { kind: "video" }));
  assert.match(image, /amp-portfolio-empty-preview is-image/);
  assert.match(video, /amp-portfolio-empty-preview is-video/);
  assert.match(image, /width="96" height="88"/);
  assert.match(video, /width="128" height="76"/);
  assert.match(video, /m89 51 9 6-9 6V51Z/);
  assert.doesNotMatch(image, /m89 51/);
  for (const html of [image, video]) {
    assert.match(html, /aria-hidden="true"/);
    assert.match(html, /focusable="false"/);
    assert.doesNotMatch(html, /amp-creation|rotate|<text|<button/);
    assert.equal(html.replace(/<[^>]*>/g, ""), "");
  }
});
