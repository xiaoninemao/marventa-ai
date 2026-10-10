import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import CreationDraftPreview from "./CreationDraftPreview";

test("image and video drafts share the same layered composition with type-specific details", () => {
  const image = renderToStaticMarkup(createElement(CreationDraftPreview, { kind: "image" }));
  const video = renderToStaticMarkup(createElement(CreationDraftPreview, { kind: "video" }));
  assert.match(image, /amp-creation-media-draft is-image/);
  assert.match(video, /amp-creation-media-draft is-video/);
  for (const layer of ["backdrop", "window", "strip"]) {
    assert.match(image, new RegExp(`amp-creation-draft-${layer}`));
    assert.match(video, new RegExp(`amp-creation-draft-${layer}`));
  }
  assert.match(video, /<b><\/b>/);
  assert.doesNotMatch(image, /<b>|m41 21/);
  assert.match(video, /m41 21/);
  for (const html of [image, video]) {
    assert.equal(html.replace(/<[^>]*>/g, ""), "");
    assert.match(html, /aria-hidden="true"/);
  }
});
