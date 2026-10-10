import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { I18nProvider } from "../../contexts/i18n_context";
import { ToastProvider } from "../../contexts/toast_context";
import PortfolioWorkView, { insertPortfolioMedia, portfolioEdgeScroll, portfolioInsertionIndex } from "./PortfolioWorkView";
import type { PortfolioScript } from "../../types/portfolio";

test("portfolio thumbnails do not repeat the title over the media preview", () => {
  const source = readFileSync(new URL("../../app/portfolio/page.tsx", import.meta.url), "utf8");
  const preview = source.split('<span className="amp-portfolio-card-preview"')[1]?.split("</span>")[0];
  assert.ok(preview);
  assert.doesNotMatch(preview, /<strong>/);
  assert.match(source, /<strong title=\{script.name\}>\{script.name \|\| t\("未命名作品", "Untitled work"\)\}<\/strong>/);
});

test("portfolio covers use case-library type badges for native works and correctly identify historical text", () => {
  const source = readFileSync(new URL("../../app/portfolio/page.tsx", import.meta.url), "utf8");
  assert.match(source, /className="amp-case-type-overlay">\{script\.media_kind === "video"/);
  assert.match(source, /t\("视频", "Video"\)/);
  assert.match(source, /script\.media_kind === "image" \? t\("图文", "Image post"\) : t\("文字档案", "Text archive"\)/);
});

test("empty native portfolio covers use an independent illustration without changing media or text archives", () => {
  const source = readFileSync(new URL("../../app/portfolio/page.tsx", import.meta.url), "utf8");
  assert.match(source, /script\.media_kind\s*\?\s*<PortfolioEmptyPreview kind=\{script\.media_kind\}/);
  assert.match(source, /script\.media\?\.\[0\]\?\.media_type === "image"/);
  assert.match(source, /script\.media\?\.\[0\]\?\.media_type === "video"/);
  assert.match(source, /: <InlineIcon name="file"/);
  assert.doesNotMatch(source, /CreationDraftPreview|amp-creation-draft/);
  const css = readFileSync(new URL("../../styles/projects.css", import.meta.url), "utf8");
  assert.ok(css.includes(".amp-portfolio-card-link:is(:hover, :focus-visible) .amp-portfolio-empty-frame"));
  assert.doesNotMatch(css, /\.amp-portfolio-card-link[^{}]*\.amp-creation-draft/);
});

test("portfolio action menus track the preview height and center on the title line", () => {
  const css = readFileSync(new URL("../../styles/projects.css", import.meta.url), "utf8");
  assert.match(css, /height:\s*var\(--amp-portfolio-preview-height\)/);
  const menu = css.match(/\.amp-redesign \.amp-portfolio-card \.amp-insight-card-menu\s*\{([^}]+)\}/)?.[1];
  assert.ok(menu);
  assert.match(menu, /top:\s*calc\(var\(--amp-portfolio-preview-height\) \+ 11px\)/);
});

test("portfolio cover and illustration heights match Content Studio without changing their independent design", () => {
  const css = readFileSync(new URL("../../styles/projects.css", import.meta.url), "utf8");
  const creationCover = css.match(/\.amp-redesign \.amp-content-canvas-preview\s*\{([^}]+)\}/)?.[1];
  const portfolioCover = css.match(/\.amp-redesign \.amp-portfolio-card\s*\{([^}]+)\}/)?.[1];
  const creationArt = css.match(/\.amp-redesign \.amp-creation-media-draft\s*\{([^}]+)\}/)?.[1];
  const portfolioArt = css.match(/\.amp-redesign \.amp-portfolio-empty-preview\s*\{([^}]+)\}/)?.[1];
  assert.ok(creationCover && portfolioCover && creationArt && portfolioArt);
  const height = (rule: string) => rule.match(/\bheight:\s*(\d+)px/)?.[1];
  assert.equal(portfolioCover.match(/--amp-portfolio-preview-height:\s*(\d+)px/)?.[1], height(creationCover));
  assert.equal(height(portfolioArt), height(creationArt));
  assert.equal(height(portfolioArt), "90");
});

const work: PortfolioScript = {
  id: "work", name: "Portfolio name", user_id: "owner", title: "Original title", content: "原始文案",
  source_session_id: "session", project_id: "project", project_title: "Project",
  project_role: "owner", status: "completed", created_at: "", updated_at: "",
  media_kind: "image", tags: ["brand"],
  media: ["first", "second", "third"].map(id => ({
    id, name: id, media_type: "image", object_key: `${id}.png`, mime_type: "image/png", file_url: `/${id}.png`,
  })),
};

test("thumbnail insertion uses gaps rather than swapping with the hovered image", () => {
  const ids = ["a", "b", "c", "d"];
  assert.deepEqual(insertPortfolioMedia(ids, "a", 2), ["b", "a", "c", "d"]);
  assert.deepEqual(insertPortfolioMedia(ids, "d", 1), ["a", "d", "b", "c"]);
  assert.deepEqual(insertPortfolioMedia(ids, "a", ids.length), ["b", "c", "d", "a"]);
  assert.deepEqual(insertPortfolioMedia(ids, "d", 0), ["d", "a", "b", "c"]);
  assert.equal(insertPortfolioMedia(ids, "b", 1), ids);
  assert.equal(insertPortfolioMedia(ids, "b", 2), ids);
  assert.equal(insertPortfolioMedia(ids, "unknown", 0), ids);
  assert.equal(insertPortfolioMedia(ids, "a", -1), ids);
  assert.equal(insertPortfolioMedia(ids, "a", 10), ids);
  assert.equal(insertPortfolioMedia(ids, "a", 1.5), ids);
});

test("pointer positions select before/after gaps even when thumbnails are horizontally scrolled", () => {
  const bounds = [{ left: -40, right: 48 }, { left: 58, right: 146 }, { left: 156, right: 244 }];
  assert.equal(portfolioInsertionIndex(bounds, -50), 0);
  assert.equal(portfolioInsertionIndex(bounds, 53), 1);
  assert.equal(portfolioInsertionIndex(bounds, 151), 2);
  assert.equal(portfolioInsertionIndex(bounds, 250), 3);
});

test("drag auto-scroll moves only near the strip edges and is bounded per frame", () => {
  assert.equal(portfolioEdgeScroll(0, 0, 200), -12);
  assert.equal(portfolioEdgeScroll(200, 0, 200), 12);
  assert.equal(portfolioEdgeScroll(100, 0, 200), 0);
  assert.equal(portfolioEdgeScroll(250, 0, 200), 0);
  assert.equal(portfolioEdgeScroll(0, 0, 0), 0);
});

function render(value: PortfolioScript, editable = true, saving = false, editing = false) {
  return renderToStaticMarkup(createElement(I18nProvider, null, createElement(ToastProvider, null, createElement(PortfolioWorkView, {
    work: value, editable, saving, editing, tagsText: "brand", onReorder: () => {},
  }))));
}

test("work content displays original copy, tags and draggable ordered thumbnails without language tabs", () => {
  const html = render(work);
  assert.match(html, /原始文案/);
  assert.match(html, /#brand/);
  assert.match(html, /amp-portfolio-work has-media/);
  assert.ok(html.indexOf("amp-portfolio-work-visual") < html.indexOf("amp-portfolio-work-copy"));
  assert.equal((html.match(/draggable="true"/g) || []).length, 3);
  assert.ok(html.indexOf('src="/first.png"') < html.indexOf('src="/second.png"'));
  assert.doesNotMatch(html, /role="tab"|中文版|English/);
  assert.doesNotMatch(html, /amp-portfolio-order-actions|前移|后移|Move earlier|Move later/);
  assert.doesNotMatch(html, /<header>/);
  assert.doesNotMatch(html, /amp-portfolio-media-sources/);
  assert.doesNotMatch(render(work, false), /draggable="true"/);
  assert.doesNotMatch(render(work, true, true), /draggable="true"/);
});

test("portfolio media and copy use two columns, stacking only when the work panel is narrow", () => {
  const css = readFileSync(new URL("../../styles/projects.css", import.meta.url), "utf8");
  assert.match(css, /\.amp-portfolio-work\.has-media\s*\{\s*grid-template-columns: minmax\(0, 1\.1fr\) minmax\(0, 0\.9fr\)/);
  assert.match(css, /@container portfolio-detail \(max-width: 560px\)/);
  assert.doesNotMatch(render({ ...work, media: [], media_kind: null }), /has-media|amp-portfolio-work-visual/);
});

test("portfolio editing exposes upload/removal and editable copy fields without source navigation", () => {
  const html = render(work, true, false, true);
  assert.match(html, /type="file"/);
  assert.match(html, /amp-portfolio-media-remove/);
  assert.match(html, /<textarea/);
  assert.match(html, /value="Original title"/);
  assert.equal((html.match(/class="amp-portfolio-add-trigger"/g) || []).length, 4);
  assert.doesNotMatch(html, /amp-portfolio-media-sources/);
  const detail = readFileSync(new URL("../../app/portfolio/[scriptId]/page.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(detail, /查看原创作|View creation/);
  assert.match(detail, /save_portfolio_edit/);
  assert.match(detail, /className="amp-button amp-button-secondary"/);
  assert.match(detail, /className="amp-button amp-button-secondary amp-button-cancel"/);
  assert.match(detail, /form="portfolio-edit-form"/);
  assert.match(detail, /PortfolioMaterialPicker/);
  assert.match(detail, /materialGap\.current = gap/);
  assert.match(detail, /uploadDraft\.media\.slice\(0, index\), \.\.\.added/);
  assert.match(detail, /onRemove=\{setPendingRemoveId\}/);
  assert.match(detail, /DeleteConfirmDialog open=\{Boolean\(pendingRemove\)\}/);
  assert.match(detail, /if \(pendingRemove\) removeMedia\(pendingRemove\.id\)/);
});

test("portfolio management names never substitute for content titles or change through content editing", () => {
  const html = render(work);
  assert.match(html, /Original title/);
  assert.doesNotMatch(html, /Portfolio name/);
  const untitled = render({ ...work, title: "" });
  assert.match(untitled, /No title yet/);
  assert.doesNotMatch(untitled, /Portfolio name/);
  const overview = readFileSync(new URL("../../app/portfolio/page.tsx", import.meta.url), "utf8");
  const detail = readFileSync(new URL("../../app/portfolio/[scriptId]/page.tsx", import.meta.url), "utf8");
  assert.match(overview, /setRenameName\(script\.name\)/);
  assert.match(overview, /update_script\(renamingScript\.id, \{ name \}\)/);
  assert.match(detail, /<h1>\{work\.name \|\| t\("未命名作品", "Untitled work"\)\}/);
  const payload = detail.split("const metadata = {")[1]?.split("};")[0];
  assert.ok(payload);
  assert.match(payload, /title: draft\.work\.title/);
  assert.doesNotMatch(payload, /\bname:/);
});
test("portfolio preview and copy stretch into fixed-height work areas", () => {
  const css = readFileSync(new URL("../../styles/projects.css", import.meta.url), "utf8");
  const image = css.match(/\.amp-redesign \.amp-portfolio-work-media :is\(img, video\)\s*\{([^}]+)\}/)?.[1];
  assert.ok(image);
  assert.match(image, /height:\s*100%/);
  assert.match(image, /object-fit:\s*contain/);
  assert.match(css, /grid-template-rows:\s*minmax\(0, 1fr\) auto/);
});

test("portfolio thumbnails remain in one scrollable row without shrinking", () => {
  const css = readFileSync(new URL("../../styles/projects.css", import.meta.url), "utf8");
  const row = css.match(/\.amp-redesign \.amp-portfolio-media-order ol\s*\{([^}]+)\}/)?.[1];
  assert.ok(row);
  assert.match(row, /flex-wrap:\s*nowrap/);
  assert.match(row, /overflow-x:\s*auto/);
  assert.match(row, /align-items:\s*flex-end/);
  assert.match(row, /padding:\s*0 6px/);
  assert.match(row, /height:\s*78px/);
  assert.match(css, /\.amp-redesign \.amp-portfolio-media-order li\s*\{\s*flex:\s*none/);
  assert.match(css, /li\.is-insert-before::before/);
  assert.doesNotMatch(css, /button\.is-drop-target/);
});

test("video works render their actual video and do not offer image drag reordering", () => {
  const html = render({ ...work, media_kind: "video", media: [{
    id: "video", name: "Video", media_type: "video", object_key: "video.mp4",
    mime_type: "video/mp4", file_url: "/video.mp4",
  }] });
  assert.match(html, /<video[^>]*src="\/video.mp4"/);
  assert.doesNotMatch(html, /draggable="true"/);
  assert.doesNotMatch(html, /amp-publication-image-nav/);
  assert.doesNotMatch(html, /amp-portfolio-media-order|amp-portfolio-thumbnail|amp-portfolio-video-remove/);
  assert.match(html, /amp-portfolio-work-visual is-video/);
});

test("video editing hides addition until the existing media is removed", () => {
  const videoWork: PortfolioScript = { ...work, media_kind: "video", media: [{
    id: "video", name: "Video", media_type: "video", object_key: "video.mp4",
    mime_type: "video/mp4", file_url: "/video.mp4",
  }] };
  const populated = render(videoWork, true, false, true);
  assert.match(populated, /amp-portfolio-video-remove/);
  assert.match(populated, /aria-label="Delete video"/);
  assert.doesNotMatch(populated, /amp-portfolio-media-order|amp-portfolio-thumbnail/);
  assert.doesNotMatch(populated, /amp-portfolio-add-trigger|Add or replace/);
  const empty = render({ ...videoWork, media: [] }, true, false, true);
  assert.doesNotMatch(empty, /amp-portfolio-add-trigger|amp-portfolio-media-order/);
  assert.match(empty, /amp-portfolio-media-empty-actions/);
  assert.doesNotMatch(empty, /multiple=""/);
  const detail = readFileSync(new URL("../../app/portfolio/[scriptId]/page.tsx", import.meta.url), "utf8");
  assert.equal((detail.match(/Remove the existing video before adding a new one/g) || []).length, 2);
});

test("portfolio creation immediately persists a named work from the standard three-field dialog", () => {
  const overview = readFileSync(new URL("../../app/portfolio/page.tsx", import.meta.url), "utf8");
  const detail = readFileSync(new URL("../../app/portfolio/[scriptId]/page.tsx", import.meta.url), "utf8");
  assert.match(overview, /create-work-title/);
  const dialog = overview.split('<dialog ref={createDialogRef}')[1]?.split("</dialog>")[0];
  assert.ok(dialog);
  assert.ok(dialog.indexOf('t("所属项目"') < dialog.indexOf('t("作品类型"'));
  assert.ok(dialog.indexOf('t("作品类型"') < dialog.indexOf('t("作品名称"'));
  assert.match(dialog, /t\(CHINESE_ACTIONS\.create, ENGLISH_ACTIONS\.create\)/);
  assert.match(overview, /await create_portfolio_work\(\{ name: newName\.trim\(\), project_id: newProjectId, media_kind: newKind \}\)/);
  assert.match(overview, /router\.push\(`\/portfolio\/\$\{encodeURIComponent\(response\.data\.id\)\}/);
  assert.doesNotMatch(overview, /\/portfolio\/new|t\("下一步"/);
  assert.doesNotMatch(detail, /create_portfolio_work|scriptId === "new"/);
});

test("empty named works fill the media column and expose centered source actions even outside edit mode", () => {
  for (const media_kind of ["image", "video"] as const) {
    const emptyWork = { ...work, media_kind, content: "", media: [] };
    const html = render(emptyWork);
    assert.match(html, /amp-portfolio-work-visual is-empty/);
    assert.match(html, /amp-portfolio-media-empty-actions/);
    assert.match(html, />Materials<\/button>|>Materials<\/span>/);
    assert.match(html, />Upload<\/button>|>Upload<\/span>/);
    assert.match(html, /type="file"/);
    assert.doesNotMatch(html, /amp-portfolio-add-trigger|amp-portfolio-media-order|<textarea/);
    assert.doesNotMatch(render(emptyWork, false), /amp-portfolio-media-empty-actions|type="file"/);
  }
  const css = readFileSync(new URL("../../styles/projects.css", import.meta.url), "utf8");
  assert.match(css, /\.amp-portfolio-work-visual\.is-empty,\s*\.amp-redesign \.amp-portfolio-work-visual\.is-video\s*\{[^}]*grid-template-rows:\s*minmax\(0, 1fr\)/);
});

test("image preview navigation reuses publication styling and hides the first-image left arrow", () => {
  const html = render(work, false);
  assert.doesNotMatch(html, /aria-label="Previous image"/);
  assert.match(html, /aria-label="Next image"/);
  assert.match(html, /amp-publication-image-nav is-next/);
  assert.doesNotMatch(render({ ...work, media: work.media?.slice(0, 1) }), /amp-publication-image-nav/);
});
