import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("asset toolbar selectors share a non-shrinking desktop width and full mobile width", () => {
  const css = readFileSync(new URL("../styles/projects.css", import.meta.url), "utf8");
  const selector = ".amp-redesign :is(.amp-insight-toolbar, .amp-case-toolbar) > .amp-enterprise-select";
  const rules = css.split(`${selector} {`).slice(1).map(rule => rule.split("}")[0]);
  assert.equal(rules.length, 2);
  assert.match(rules[0], /flex:\s*0 0 144px/);
  assert.match(rules[0], /width:\s*144px/);
  assert.match(rules[1], /flex:\s*none/);
  assert.match(rules[1], /width:\s*100%/);
});

test("project application filter is wider without changing the shared asset selector widths", () => {
  const source = readFileSync(new URL("../app/projects/[projectId]/page.tsx", import.meta.url), "utf8");
  assert.match(source, /ariaLabel=\{t\("筛选应用", "Filter applications"\)\}\s*className="w-44 shrink-0"/);
});
