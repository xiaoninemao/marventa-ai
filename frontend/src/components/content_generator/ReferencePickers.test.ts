import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AuthProvider } from "../../contexts/auth_context.tsx";
import { I18nProvider } from "../../contexts/i18n_context.tsx";
import { ToastProvider } from "../../contexts/toast_context.tsx";
import ReferencePanel from "./ReferencePanel.tsx";
import MaterialReferencePicker from "./MaterialReferencePicker.tsx";
import ReferencePickerDialog from "./ReferencePickerDialog.tsx";
import ReferencePickerSearch from "./ReferencePickerSearch.tsx";

function renderPicker(element: ReactElement) {
  return renderToStaticMarkup(createElement(AuthProvider, null,
    createElement(I18nProvider, null, createElement(ToastProvider, null, element)),
  ));
}

function assertCompactFooter(html: string) {
  const footer = html.match(/<footer class="amp-reference-picker-footer">([\s\S]*?)<\/footer>/)?.[1];
  assert.ok(footer);
  assert.match(footer, /^<span>0 selected<\/span><button/);
  assert.match(footer, /class="amp-button amp-button-secondary amp-button-cancel"/);
  assert.match(footer, /class="amp-button amp-button-primary"/);
  assert.doesNotMatch(footer, /flex-1|min-h-\[44px\]/);
  assert.equal((footer.match(/<button /g) || []).length, 2);
}

function assertCommonLayout(html: string) {
  assert.match(html, /amp-reference-picker-dialog/);
  assert.match(html, /max-w-2xl/);
  assert.doesNotMatch(html, /max-w-3xl|amp-material-reference-body/);
  assert.match(html, /<div class="amp-reference-picker-layout">/);
  assert.match(html, /<header class="amp-reference-picker-header">/);
  assert.match(html, /<main class="amp-reference-picker-body">/);
}

test("shared reference search preserves the standard input, icon and clear action", () => {
  const html = renderPicker(createElement(ReferencePickerSearch, {
    value: "Work", onChange: () => {}, ariaLabel: "Search works", placeholder: "Search work names",
  }));
  assert.match(html, /aria-label="Search works"/);
  assert.match(html, /value="Work"/);
  assert.match(html, /aria-label="Clear search"/);
  assert.match(html, /h-10 w-full/);
  assert.match(html, /h-3\.5 w-3\.5/);
  assert.match(html, /text-xs/);
});

test("all reference picker headers use compact spacing above their content", () => {
  const css = readFileSync(new URL("../../styles/projects.css", import.meta.url), "utf8");
  const header = css.split(".amp-redesign .amp-reference-picker-header {")[1]?.split("}")[0];
  assert.ok(header);
  assert.match(header, /min-height:\s*40px/);
  assert.match(header, /padding:\s*12px 20px 4px/);
  const panel = readFileSync(new URL("./ReferencePanel.tsx", import.meta.url), "utf8");
  assert.match(panel, /gap-2 px-3 pt-1 sm:flex-nowrap/);
});

for (const initial_tab of ["insight", "case"] as const) {
  test(`${initial_tab} reference picker uses the shared compact footer with a leading count`, () => {
    const html = renderPicker(createElement(ReferencePanel, {
      open: false, initial_tab, project_id: "project",
      selected_insight_ids: [], selected_case_ids: [],
      onConfirm: () => {}, onClose: () => {},
    }));
    assertCompactFooter(html);
    assertCommonLayout(html);
  });
}

test("material picker keeps the shared footer without instructional header copy", () => {
  const html = renderPicker(createElement(MaterialReferencePicker, {
    open: false, projectId: "project", selectedIds: [], selectedLabels: [],
    onConfirm: () => {}, onClose: () => {},
  }));
  const footer = html.match(/<footer class="amp-reference-picker-footer">([\s\S]*?)<\/footer>/)?.[1];
  assert.ok(footer);
  assert.match(footer, /^<span class="amp-material-reference-limit">0 selected · Images 0\/5 · Videos 0\/1<\/span><button/);
  assert.match(footer, /class="amp-button amp-button-secondary amp-button-cancel"/);
  assert.match(footer, /class="amp-button amp-button-primary"/);
  assertCommonLayout(html);
  const header = html.match(/<header[^>]*>([\s\S]*?)<\/header>/)?.[1];
  assert.ok(header);
  assert.match(header, /Reference materials/);
  assert.doesNotMatch(header, /<p>|Choose a material set|select materials to reference/);
});

test("material set navigation uses the same dialog header and accessible title", () => {
  const html = renderPicker(createElement(ReferencePickerDialog, {
    open: false, title: "Material set", onClose: () => {},
    leading: createElement("button", { type: "button", "aria-label": "Back to material sets" }, "Back"),
  }, createElement("main", { className: "amp-reference-picker-body" }, "Materials")));
  assertCommonLayout(html);
  assert.match(html, /aria-label="Back to material sets"/);
  const titleId = html.match(/aria-labelledby="([^"]+)"/)?.[1];
  assert.ok(titleId);
  assert.ok(html.includes(`<h2 id="${titleId}">Material set</h2>`));
});
