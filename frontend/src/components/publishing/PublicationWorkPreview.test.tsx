import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { I18nProvider } from "../../contexts/i18n_context";
import { ToastProvider } from "../../contexts/toast_context";
import PortfolioWorkView from "../portfolio/PortfolioWorkView";
import { publicationWorkPreview } from "./PublicationWorkPreview";
import type { PublicationContent } from "../../types/publishing";

const items: PublicationContent[] = ["image", "document", "image"].map((kind, index) => ({
  id: String(index), position: 2 - index, plan_id: "plan", name: String(index),
  media_type: kind === "document" ? "document" : "image", mime_type: "image/png",
  file_url: `/snapshot-${index}.png`, source_material_id: "", created_at: "", updated_at: "",
}));
test("publication preview uses the stored snapshot order, title, copy and tags in the portfolio view", () => {
  const work = publicationWorkPreview({ name: "Plan", media_mode: "image_text" }, items,
    { title: "Snapshot headline", content: "Snapshot copy", tags: ["brand"] });
  assert.deepEqual(work.media?.map(item => item.id), ["2", "0"]);
  assert.deepEqual(items.map(item => item.id), ["0", "1", "2"]);
  const html = renderToStaticMarkup(createElement(I18nProvider, null,
    createElement(ToastProvider, null, createElement(PortfolioWorkView,
      { work, editable: false, saving: false, onReorder: () => {} }))));
  assert.match(html, /amp-portfolio-work-visual/);
  assert.match(html, /amp-portfolio-work-copy/);
  assert.match(html, /Snapshot headline|Snapshot copy|#brand/);
  assert.doesNotMatch(html, /type="file"|<textarea|draggable="true"/);
  const source = readFileSync(new URL("./PublicationWorkPreview.tsx", import.meta.url), "utf8");
  assert.match(source, /fetch_publication_contents\(id\), fetch_publication_copy\(id\)/);
  assert.doesNotMatch(source, /fetch_script|fetch_scripts/);
});
test("video publication previews use the same full-height single player without thumbnails", () => {
  const work = publicationWorkPreview({ name: "Plan", media_mode: "video" },
    [{ ...items[0], media_type: "video", file_url: "/snapshot.mp4" }],
    { title: "Video", content: "Copy", tags: [] });
  const html = renderToStaticMarkup(createElement(I18nProvider, null,
    createElement(ToastProvider, null, createElement(PortfolioWorkView,
      { work, editable: false, saving: false, onReorder: () => {} }))));
  assert.match(html, /<video/);
  assert.match(html, /amp-portfolio-work-visual is-video/);
  assert.doesNotMatch(html, /amp-portfolio-media-order/);
});
