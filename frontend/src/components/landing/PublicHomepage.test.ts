import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const css = readFileSync(new URL("../../styles/landing.css", import.meta.url), "utf8");

test("public sections share fluid desktop gutters instead of a fixed content width", () => {
  const rule = css.match(/\.amp-public-container\s*\{([^}]+)\}/)?.[1];
  assert.ok(rule);
  assert.match(rule, /margin-inline:\s*auto/);
  assert.match(rule, /width:\s*calc\(100% - clamp\(112px, 10vw, 240px\)\)/);
  assert.doesNotMatch(rule, /max-width:/);
});

test("public tablet and mobile gutters keep their existing responsive sizes", () => {
  for (const [breakpoint, gutter] of [[1100, 64], [800, 48], [560, 40]]) {
    const media = css.split(`@media (max-width: ${breakpoint}px) {`)[1]?.split("\n@media ")[0];
    assert.ok(media);
    assert.match(media, new RegExp(
      `\\.amp-public-container \\{\\s*width: calc\\(100% - ${gutter}px\\);`,
    ));
  }
});

test("public descriptions use their available column width", () => {
  for (const selector of [".amp-public-hero-statement", ".amp-public-value-copy > p"]) {
    const rule = css.split(`${selector} {`)[1]?.split("}")[0];
    assert.ok(rule);
    assert.doesNotMatch(rule, /(?:max-)?width\s*:/);
    assert.doesNotMatch(rule, /white-space:\s*nowrap/);
  }
});

test("the public capability heading wraps naturally instead of forcing a line break", () => {
  const source = readFileSync(new URL("./PublicHomepage.tsx", import.meta.url), "utf8");
  const heading = source.match(/<h2 id="public-capabilities-title">([\s\S]*?)<\/h2>/)?.[1];
  assert.ok(heading);
  assert.doesNotMatch(heading, /<br/);
  assert.ok(heading.includes('"Project work becomes shared capability."'));
});
