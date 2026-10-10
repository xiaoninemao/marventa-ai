import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { I18nProvider } from "../../contexts/i18n_context";
import { ToastProvider } from "../../contexts/toast_context";
import PortfolioAddMedia from "./PortfolioAddMedia";

test("insertion plus identifies its position and opens an accessible source menu", () => {
  const html = renderToStaticMarkup(createElement(I18nProvider, null,
    createElement(ToastProvider, null, createElement(PortfolioAddMedia, {
      index: 2, disabled: false, onChoose: () => {},
    }))));
  assert.match(html, /aria-label="Add images at position 3"/);
  assert.match(html, /aria-haspopup="menu"/);
  assert.match(html, /aria-expanded="false"/);
  const source = readFileSync(new URL("./PortfolioAddMedia.tsx", import.meta.url), "utf8");
  assert.match(source, /createPortal/);
  assert.match(source, /choose\("materials"\)/);
  assert.match(source, /choose\("upload"\)/);
  assert.match(source, /onChoose\(source, index\)/);
  assert.doesNotMatch(source, /amp-enterprise-select-option|menuFont|getComputedStyle/);
});

test("add and remove icons are transparent, stationary and sized independently from thumbnail icons", () => {
  const css = readFileSync(new URL("../../styles/projects.css", import.meta.url), "utf8");
  for (const selector of [".amp-redesign .amp-portfolio-add-trigger",
    ".amp-redesign .amp-portfolio-media-order .amp-portfolio-media-remove"]) {
    const rule = css.split(`${selector} {`)[1]?.split("}")[0];
    assert.ok(rule);
    assert.match(rule, /background:\s*transparent/);
    assert.match(rule, /border:\s*0/);
    assert.match(rule, /transform:\s*none/);
  }
  assert.match(css, /\.amp-portfolio-media-order \.amp-portfolio-add-trigger svg\s*\{[^}]*height:\s*16px/);
  assert.match(css, /\.amp-portfolio-add-menu \.amp-portfolio-add-option\s*\{[^}]*justify-content:\s*flex-start/);
});

test("source menu uses independent compact system typography rather than enterprise option styles", () => {
  const css = readFileSync(new URL("../../styles/projects.css", import.meta.url), "utf8");
  const menu = css.split(".amp-portfolio-add-menu {")[1]?.split("}")[0];
  const option = css.split(".amp-portfolio-add-menu .amp-portfolio-add-option {")[1]?.split("}")[0];
  assert.ok(menu);
  assert.ok(option);
  assert.match(menu, /font-family:\s*"Helvetica Neue", "Segoe UI", "PingFang SC"/);
  assert.match(option, /font-family:\s*inherit/);
  assert.match(option, /font-size:\s*13px/);
  assert.match(option, /font-weight:\s*400/);
  assert.match(option, /min-height:\s*36px/);
});

test("material picker omits search and uses compact title/content spacing", () => {
  const source = readFileSync(new URL("./PortfolioMaterialPicker.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(source, /RedesignInput|type="search"|setQuery/);
  const css = readFileSync(new URL("../../styles/projects.css", import.meta.url), "utf8");
  assert.match(css, /\.amp-portfolio-material-picker \.amp-reference-picker-header\s*\{[^}]*min-height:\s*48px/);
});
