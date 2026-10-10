import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./PublicationWorkDialog.tsx", import.meta.url), "utf8");

test("work dialog only searches and selects project-native work cards", () => {
  assert.match(source, /fetch_scripts\(projectId\)/);
  assert.match(source, /work\.project_id === projectId/);
  assert.match(source, /Boolean\(work\.media_kind\).*Boolean\(work\.media\?\.length\)/);
  assert.match(source, /type="radio" name="publication-work"/);
  assert.match(source, /select_publication_work\(plan\.id, selected\.id\)/);
  assert.match(source, /work\.name\.toLocaleLowerCase/);
  assert.doesNotMatch(source, /channel_account_id|scheduled_for|PublicationSchedulePicker|selected\.content/);
  assert.doesNotMatch(source, /type="file"|upload_publication|save_publication_copy/);
});

test("work selection directly reuses Content Studio reference picker layout and actions", () => {
  assert.match(source, /<ReferencePickerDialog open=\{open\} title=\{t\("选择作品", "Select work"\)\}/);
  assert.match(source, /className="amp-reference-picker-body"/);
  assert.match(source, /className="amp-reference-card-grid amp-publication-work-grid"/);
  assert.match(source, /className="amp-reference-picker-footer justify-end"/);
  assert.doesNotMatch(source, /<dialog|amp-publication-settings-dialog|amp-publication-form|text-xl|p-6/);
});

test("work cards display three per desktop row without changing other reference grids", () => {
  const css = readFileSync(new URL("../../styles/projects.css", import.meta.url), "utf8");
  assert.match(css, /\.amp-publication-work-grid\s*\{\s*grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\)/);
  assert.match(css, /@media \(max-width: 560px\)\s*\{\s*\.amp-redesign \.amp-publication-work-grid\s*\{\s*grid-template-columns:\s*minmax\(0, 1fr\)/);
});

test("single-work picker has no count and excludes unfinished, empty and foreign-project works", () => {
  assert.match(source, /work\.project_id === projectId && work\.status === "completed"/);
  assert.match(source, /Boolean\(work\.media_kind\) && Boolean\(work\.media\?\.length\)/);
  const footer = source.split("<footer")[1]?.split("</footer>")[0];
  assert.ok(footer);
  assert.doesNotMatch(footer, /<span|已选|selected/);
  assert.match(footer, /amp-button-secondary amp-button-cancel/);
  assert.match(footer, /amp-button-primary/);
});

test("work picker shares the reference search rather than overriding dimensions", () => {
  assert.match(source, /<ReferencePickerSearch value=\{query\} onChange=\{setQuery\}/);
  const references = readFileSync(new URL("../content_generator/ReferencePanel.tsx", import.meta.url), "utf8");
  assert.match(references, /<ReferencePickerSearch value=\{search\} onChange=\{setSearch\}/);
  const css = readFileSync(new URL("../../styles/projects.css", import.meta.url), "utf8");
  assert.doesNotMatch(css, /\.amp-publication-work-dialog[^{}]*\{/);
});

test("empty and no-match states reuse the standard dialog state and icon treatment", () => {
  assert.match(source, /className="amp-dialog-state amp-empty-state"/);
  assert.match(source, /<EmptyStateIcon name=\{hasFilters \? "search" : "briefcase"\}/);
  assert.match(source, /t\("暂无可选作品", "No works available"\)/);
  assert.match(source, /t\("没有匹配的作品", "No matching works"\)/);
  assert.match(source, /const searchQuery = query\.trim\(\)\.toLocaleLowerCase\(locale\)/);
});

test("work type filter composes with search and compact reference toolbar spacing", () => {
  assert.match(source, /value=\{typeFilter\}/);
  assert.match(source, /work\.media_kind === typeFilter/);
  assert.match(source, /onChange=\{setTypeFilter\}/);
  assert.match(source, /t\("图文作品", "Image and copy"\)/);
  assert.match(source, /t\("视频作品", "Video work"\)/);
  assert.match(source, /setTypeFilter\("all"\)/);
  assert.match(source, /gap-2 px-3 pt-1 sm:flex-nowrap/);
});

test("project switching resets selection and plan details no longer edit content", () => {
  assert.match(source, /setWorks\(\[\]\); setWorkId\(""\); setVideoErrors\(\{\}\)/);
  assert.match(source, /if \(cancelled\) return/);
  const detail = readFileSync(new URL("../../app/publishing/[planId]/page.tsx", import.meta.url), "utf8");
  assert.match(detail, /<PublicationWorkPreview/);
  assert.doesNotMatch(detail, /PublicationContentPanel|PublicationCopyEditor|contentBusy/);
  const overview = readFileSync(new URL("../../app/publishing/page.tsx", import.meta.url), "utf8");
  assert.match(detail, /<PublicationWorkDialog open=\{workDialogOpen\}/);
  assert.match(source, /select_publication_work\(plan\.id/);
  assert.match(overview, /create_publication_plan\(\{ project_id: formProjectId, name: planName\.trim\(\) \}\)/);
  assert.doesNotMatch(overview, /portfolio_id:|scheduled_for: publicationSchedule|<PublicationWorkDialog/);
});

test("saved video works show a real video frame and explicit retry instead of a placeholder icon", () => {
  assert.match(source, /<video src=\{work\.media\?\.\[0\]\?\.file_url\} muted playsInline preload="metadata"/);
  assert.match(source, /video\.currentTime = Math\.min\(0\.1, video\.duration \/ 2\)/);
  assert.match(source, /onError=\{\(\) => setVideoErrors/);
  assert.match(source, /t\("视频封面加载失败", "Could not load video cover"\)/);
  assert.match(source, /event\.preventDefault\(\); event\.stopPropagation\(\)/);
  assert.doesNotMatch(source, /<InlineIcon name="video"/);
  const css = readFileSync(new URL("../../styles/projects.css", import.meta.url), "utf8");
  assert.match(css, /\.amp-publication-work-option-cover :is\(img, video\)\s*\{[^}]*object-fit:\s*contain/);
});

test("select work appears once beside publication settings, including empty plans", () => {
  const detail = readFileSync(new URL("../../app/publishing/[planId]/page.tsx", import.meta.url), "utf8");
  const header = detail.split('<div className="amp-publication-header-actions">')[1]?.split("</header>")[0];
  assert.ok(header);
  assert.match(header, /t\("选择作品", "Select work"\)/);
  assert.match(header, /t\("发布设置", "Publication settings"\)/);
  assert.doesNotMatch(header, /plan\.content_count > 0/);
  assert.equal((detail.match(/t\("选择作品", "Select work"\)/g) || []).length, 1);
});
