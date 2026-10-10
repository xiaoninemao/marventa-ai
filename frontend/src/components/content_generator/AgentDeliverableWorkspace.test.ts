import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { I18nProvider } from "../../contexts/i18n_context.tsx";
import { ToastProvider } from "../../contexts/toast_context.tsx";
import AgentDeliverableWorkspace from "./AgentDeliverableWorkspace.tsx";
import type { CreativeDeliverable } from "../../types/content_generator.ts";

test("media-only and copy-only workspaces remain saveable without invented text or empty copy actions", () => {
  const fields = {
    title: "", publication_copy: "", tags: [], visual_prompt: "", image_material_id: "",
    image_url: "", additional_image_material_ids: [], additional_image_urls: [],
    video_script: "", storyboard: [], created_at: "",
  };
  const values: CreativeDeliverable[] = [
    { ...fields, id: "image-only", media_kind: "image", image_url: "/image.png" },
    { ...fields, id: "video-only", media_kind: "video", video_url: "/video.mp4" },
    { ...fields, id: "copy-only", media_kind: "image", publication_copy: "Only copy" },
  ];
  for (const value of values) {
    const html = renderToStaticMarkup(createElement(I18nProvider, null, createElement(ToastProvider, null,
      createElement(AgentDeliverableWorkspace, {
        deliverable: value, disabled: false, blockedReason: "", savingWork: false, onSaveWork: () => {}, onCopy: () => {},
      }))));
    assert.match(html, />Save<\/button>/);
    assert.doesNotMatch(html, /aria-label="Copy title"/);
    if (!value.publication_copy) {
      assert.match(html, /No copy yet/);
      assert.doesNotMatch(html, /aria-label="Copy publication copy"/);
    } else {
      assert.match(html, /Only copy/);
      assert.match(html, /aria-label="Copy publication copy"/);
    }
  }
});

test("work images remain fully visible and centered within their composition cells", () => {
  const css = readFileSync(new URL("../../styles/projects.css", import.meta.url), "utf8");
  const rule = css.match(/\.amp-redesign \.amp-agent-image-composition img\s*\{([^}]+)\}/)?.[1];
  assert.ok(rule);
  assert.match(rule, /object-fit:\s*contain\s*;/);
  assert.match(rule, /object-position:\s*center\s*;/);
  assert.doesNotMatch(rule, /object-fit:\s*cover/);
});

test("Agent deliverable renders media, title, copy, tags and video production fields", () => {
  const html = renderToStaticMarkup(createElement(
    I18nProvider,
    null,
    createElement(
      ToastProvider,
      null,
      createElement(AgentDeliverableWorkspace, {
        deliverable: {
          id: "deliverable",
          media_kind: "video",
          title: "Launch title",
          publication_copy: "Publication copy",
          tags: ["launch", "product"],
          visual_prompt: "Key visual",
          image_material_id: "material",
          image_url: "http://127.0.0.1:8765/media/generated.png",
          additional_image_material_ids: ["material-2"],
          additional_image_urls: ["http://127.0.0.1:8765/media/generated-2.png"],
          video_script: "Opening hook and complete voiceover",
          storyboard: ["Opening shot", "Product demonstration"],
          created_at: "2026-10-08T00:00:00+00:00",
        },
        disabled: false,
        blockedReason: "",
        savingWork: false,
        onSaveWork: () => {},
        onCopy: () => {},
      }),
    ),
  ));

  assert.match(html, /Video creation package/);
  assert.match(html, /Launch title/);
  assert.match(html, /Publication copy/);
  assert.match(html, /#launch/);
  assert.match(html, /Opening hook and complete voiceover/);
  assert.match(html, /Opening shot/);
  assert.doesNotMatch(html, /project materials/);
  assert.match(html, /amp-agent-image-composition is-count-2/);
  assert.equal((html.match(/<img/g) || []).length, 2);
  assert.ok(
    html.indexOf("amp-agent-image-composition") < html.indexOf("Publication copy"),
    "media composition should render above the written deliverable",
  );
  assert.doesNotMatch(html, /Image order|Previous image|Next image/);
  assert.doesNotMatch(html, /Quality check/);
});

const imageWork: CreativeDeliverable = {
  id: "work", media_kind: "image", title: "Work", publication_copy: "Copy", tags: [],
  visual_prompt: "", image_material_id: "", image_url: "/one.png",
  additional_image_material_ids: [], additional_image_urls: ["/two.png"],
  video_script: "", storyboard: [], created_at: "2026-10-08T00:00:00Z",
};

function renderWork(deliverable: CreativeDeliverable, historical = false) {
  return renderToStaticMarkup(createElement(I18nProvider, null,
    createElement(ToastProvider, null, createElement(AgentDeliverableWorkspace, {
      deliverable, historical, disabled: historical, blockedReason: "History preview",
      savingWork: false, onSaveWork: () => {}, onCopy: () => {},
      onRestore: () => {}, onReturnToCurrent: () => {},
    })),
  ));
}

test("work display leaves image references to the composer", () => {
  const html = renderWork(imageWork);
  assert.doesNotMatch(html, /Reference image/);
  const composition = html.slice(html.indexOf("amp-agent-image-composition"), html.indexOf("amp-agent-deliverable-content"));
  assert.doesNotMatch(composition, /<button/);
});

test("history preview offers restoration without image reference actions", () => {
  const html = renderWork(imageWork, true);
  assert.match(html, /Previewing a historical version/);
  assert.match(html, /Restore as new version/);
  assert.match(html, /amp-work-history-return amp-text-action/);
  assert.match(html, /amp-work-history-restore amp-text-action amp-text-action-primary/);
  assert.doesNotMatch(html, /Reference image/);
});

test("video work renders its actual video instead of an image grid", () => {
  const html = renderWork({
    ...imageWork, media_kind: "video", video_url: "/work.mp4",
    image_url: "", additional_image_urls: [],
  });
  assert.match(html, /<video[^>]*src="\/work.mp4"/);
  assert.doesNotMatch(html, /amp-agent-image-composition|Reference image/);
});

test("every image stays in one square composition with balanced rows and stable ordering", () => {
  for (const count of [1, 2, 3, 4, 5, 6, 7, 8, 9, 17, 50]) {
    const urls = Array.from({ length: count }, (_, index) => `/image-${index + 1}.png`);
    const html = renderWork({ ...imageWork, image_url: urls[0], additional_image_urls: urls.slice(1) });
    assert.equal((html.match(/<img/g) || []).length, count);
    assert.equal((html.match(/class="amp-agent-image-composition /g) || []).length, 1);
    if (count > 4) {
      const rows = [...html.matchAll(/class="amp-agent-image-row"[^>]*>([\s\S]*?)<\/div>/g)];
      assert.equal(rows.length, Math.round(Math.sqrt(count)));
      const sizes = rows.map(row => (row[1].match(/<figure/g) || []).length);
      assert.equal(sizes.reduce((total, size) => total + size, 0), count);
      assert.ok(Math.max(...sizes) - Math.min(...sizes) <= 1);
      assert.ok(html.includes(`grid-template-rows:${sizes.map(size => `minmax(0, ${size}fr)`).join(" ")}`));
    }
    let previous = -1;
    for (const [index, url] of urls.entries()) {
      const current = html.indexOf(`src="${url}"`);
      assert.ok(current > previous, `Image ${index + 1} should preserve its position in a ${count}-image work`);
      if (count > 1) assert.ok(html.includes(`alt="Work, image ${index + 1}"`));
      previous = current;
    }
  }
});

test("the square work canvas uses the panel width without desktop or mobile height clamps", () => {
  const css = readFileSync(new URL("../../styles/projects.css", import.meta.url), "utf8");
  const rule = css.match(/\.amp-redesign \.amp-agent-image-composition\s*\{([^}]+)\}/)?.[1];
  assert.ok(rule);
  assert.match(rule, /aspect-ratio:\s*1\s*;/);
  assert.match(rule, /width:\s*100%\s*;/);
  assert.doesNotMatch(rule, /(?:min-|max-)?height\s*:/);
  for (const selector of ["amp-agent-deliverable-layout", "amp-agent-deliverable-header"]) {
    const block = css.match(new RegExp(`\\.amp-redesign \\.${selector}\\s*\\{([^}]+)\\}`))?.[1];
    assert.ok(block);
    assert.doesNotMatch(block, /max-width\s*:/);
  }
});
