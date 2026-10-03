import assert from "node:assert/strict";
import test from "node:test";
import { createElement, type ComponentProps, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { I18nProvider } from "../../contexts/i18n_context.tsx";
import { ToastProvider } from "../../contexts/toast_context.tsx";
import type { ProjectMaterial } from "../../types/publishing.ts";
import MaterialPickerOption, { MaterialPickerSetCover } from "./MaterialPickerOption.tsx";

function material(media_type: ProjectMaterial["media_type"]): ProjectMaterial {
  return {
    id: "material", project_id: "project", parent_id: "set", node_type: "file",
    name: "Sample material", media_type, mime_type: "", file_size: 0,
    object_key: "", file_url: `/files/sample.${media_type}`, material_count: 0,
    image_count: 0, video_count: 0, document_count: 0, covers: [],
    created_by_user_id: "", creator_name: "", creator_avatar_url: "",
    created_at: "", updated_at: "",
  };
}

function render(element: ReactElement) {
  return renderToStaticMarkup(createElement(I18nProvider, null,
    createElement(ToastProvider, null, element),
  ));
}

function renderOption(overrides: Partial<ComponentProps<typeof MaterialPickerOption>> = {}) {
  return render(createElement(MaterialPickerOption, {
    material: material("image"), selected: false,
    blockedReason: "Selection limit reached", onChange: () => {}, ...overrides,
  }));
}

for (const mediaType of ["image", "video", "document"] as const) {
  test(`${mediaType} picker option uses the publication card and real media preview`, () => {
    const html = renderOption({ material: material(mediaType) });
    assert.match(html, /<label class="amp-publication-material-option">/);
    assert.match(html, /class="amp-publication-material-cover"/);
    assert.match(html, /type="checkbox"/);
    assert.match(html, /<strong title="Sample material">Sample material<\/strong>/);
    if (mediaType === "image") assert.match(html, /<img[^>]+src="\/files\/sample.image"/);
    if (mediaType === "video") {
      assert.match(html, /<video[^>]+src="\/files\/sample.video"/);
      assert.match(html, /muted=""[^>]+preload="metadata"/);
      assert.doesNotMatch(html, /autoplay/);
    }
    if (mediaType === "document") assert.match(html, /class="amp-material-document-thumbnail"/);
  });
}

test("selected references have a checked box and the publication selection border", () => {
  const html = renderOption({ selected: true, ariaLabel: "Reference material: Sample material" });
  assert.match(html, /class="amp-publication-material-option is-selected"/);
  assert.match(html, /checked=""/);
  assert.match(html, /aria-label="Reference material: Sample material"/);
});

test("unavailable options remain toast-guarded and checked imported materials need not be highlighted", () => {
  const html = renderOption({
    selected: true, highlighted: false, disabled: true, description: "Already added",
  });
  assert.match(html, /<label class="amp-publication-material-option">/);
  assert.match(html, /aria-disabled="true"/);
  assert.match(html, /checked=""/);
  assert.match(html, /<small>Already added<\/small>/);
  assert.doesNotMatch(html, /<input[^>]+\sdisabled(?:=|\s|>)/);
});

test("publishing copy selection retains its radio group", () => {
  const html = renderOption({
    material: material("document"), inputType: "radio", inputName: "publication-copy-material",
  });
  assert.match(html, /type="radio"/);
  assert.match(html, /name="publication-copy-material"/);
});

test("material sets share the publishing image and video collage", () => {
  const html = render(createElement(MaterialPickerSetCover, {
    hasMaterials: true,
    covers: [
      { id: "image", media_type: "image", object_key: "", file_url: "/files/image.png" },
      { id: "video", media_type: "video", object_key: "", file_url: "/files/video.mp4" },
    ],
  }));
  assert.match(html, /class="amp-publication-set-cover"/);
  assert.match(html, /class="amp-material-collage has-2"/);
  assert.match(html, /<img[^>]+src="\/files\/image.png"/);
  assert.match(html, /<video[^>]+src="\/files\/video.mp4"/);
});

test("copy-only and empty material sets retain their publishing placeholders", () => {
  const copy = render(createElement(MaterialPickerSetCover, { covers: [], hasMaterials: true }));
  const empty = render(createElement(MaterialPickerSetCover, { covers: [], hasMaterials: false }));
  assert.match(copy, /Copy collection/);
  assert.match(empty, /No materials yet/);
  assert.doesNotMatch(copy + empty, /<img|<video/);
});
