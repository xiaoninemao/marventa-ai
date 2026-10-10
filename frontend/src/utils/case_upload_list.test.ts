import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("case upload file list has a fixed scrollable height and opens below the toggle", () => {
  const css = readFileSync(new URL("../styles/projects.css", import.meta.url), "utf8");
  const rule = css.split('dialog[aria-labelledby="create-case-title"] .amp-insight-selected-files ul {')[1]?.split("}")[0];
  assert.ok(rule);
  assert.match(rule, /height:\s*180px/);
  assert.match(rule, /bottom:\s*auto/);
  assert.match(rule, /top:\s*calc\(100% \+ 7px\)/);
  assert.match(rule, /overscroll-behavior:\s*contain/);
  assert.match(css, /\.amp-insight-selected-files ul\s*\{[^}]*overflow-y:\s*auto/);
});
