import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

test("obsolete publication composer components and media editing utilities are removed", () => {
  for (const file of [
    "./PublicationContentPanel.tsx", "./PublicationCopyEditor.tsx",
    "./PublicationContentMedia.tsx", "./PublicationImageGallery.tsx",
    "../../utils/publication_media.ts", "../../utils/publication_media.test.ts",
  ]) {
    assert.equal(existsSync(new URL(file, import.meta.url)), false, file);
  }
  const css = readFileSync(new URL("../../styles/projects.css", import.meta.url), "utf8");
  assert.doesNotMatch(css, /amp-publication-(?:composer|editor-main|copy-fields|image-gallery|image-thumbnails|video-player|add-menu|picker-body)/);
  assert.doesNotMatch(css, /amp-publication-(?:selected-copy|copy-preview|create-settings|work-selection)/);
  assert.doesNotMatch(css, /amp-work-reference-chip/);
  assert.match(css, /\.amp-publication-image-nav\s*\{/);
  assert.match(css, /\.amp-publication-picker-grid\s*\{/);
});

test("publication services only expose draft creation, work selection, preview and settings", () => {
  const api = readFileSync(new URL("../../services/publishing_api.ts", import.meta.url), "utf8");
  for (const name of [
    "schedule_publication_work", "update_publication_copy", "upload_publication_content",
    "import_publication_materials", "fetch_publication_content_text",
    "delete_publication_content", "reorder_publication_images",
  ]) assert.doesNotMatch(api, new RegExp(`export async function ${name}\\b`));
  for (const name of [
    "create_publication_plan", "select_publication_work", "fetch_publication_contents",
    "fetch_publication_copy", "update_publication_plan", "delete_publication_plan",
  ]) assert.match(api, new RegExp(`export async function ${name}\\b`));
  const create = api.split("export async function create_publication_plan(payload: {")[1]?.split("}):")[0];
  assert.ok(create);
  assert.match(create, /project_id: string;\s*name: string;/);
  assert.doesNotMatch(create, /portfolio_id|media_mode|channel_account_id|scheduled_for/);
});
