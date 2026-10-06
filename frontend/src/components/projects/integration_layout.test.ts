import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const css = readFileSync(new URL("../../styles/projects.css", import.meta.url), "utf8");

test("integration accounts fit the actual container rather than imposing oversized fixed column minima", () => {
  const section = css.match(/\.amp-redesign \.amp-project-channels \{([^}]+)\}/)?.[1];
  const main = css.match(/\.amp-redesign \.amp-project-integration-main \{([^}]+)\}/)?.[1];
  assert.ok(section && main);
  assert.match(section, /container-type: inline-size/);
  assert.match(main, /minmax\(0, 1\.3fr\)/);
  assert.match(main, /minmax\(0, 0\.75fr\)/);
  assert.match(main, /max-content 36px/);
  assert.match(main, /min-width: 0/);
  assert.doesNotMatch(main, /minmax\(180px|minmax\(145px/);
  assert.match(css, /@container \(max-width: 600px\)/);
});

test("compact integration layout retains all fields and does not hide the account action menu", () => {
  assert.match(css, /"app account actions"\s*"creator created created"/);
  const row = css.match(/\.amp-redesign \.amp-project-integration-row \{([^}]+)\}/)?.[1];
  assert.ok(row);
  assert.match(row, /overflow: visible/);
  assert.doesNotMatch(row, /overflow: hidden/);
  assert.match(css, /"app actions"\s*"account account"\s*"creator creator"\s*"created created"/);
});
