import assert from "node:assert/strict";
import test from "node:test";
import { materialCopyTitle } from "./material_copy_title.ts";

test("uses the first non-empty line without changing the body", () => {
  const text = "\n  Launch plan  \r\nSecond line";
  assert.equal(materialCopyTitle(text), "Launch plan");
  assert.equal(text, "\n  Launch plan  \r\nSecond line");
  assert.equal(materialCopyTitle(" \n\t"), "");
});

test("ends titles at the first Chinese or English sentence", () => {
  assert.equal(materialCopyTitle("第一句话。第二句话。"), "第一句话。");
  assert.equal(materialCopyTitle("开始！继续。"), "开始！");
  assert.equal(materialCopyTitle("Ready? Next step."), "Ready?");
  assert.equal(materialCopyTitle("First sentence. Second sentence."), "First sentence.");
  assert.equal(materialCopyTitle("Version 1.2 is ready\nDetails"), "Version 1.2 is ready");
});

test("supports hard breaks and Unicode line separators", () => {
  assert.equal(materialCopyTitle("First\rSecond"), "First");
  assert.equal(materialCopyTitle("First\u2028Second"), "First");
  assert.equal(materialCopyTitle("First\u2029Second"), "First");
});

test("normalizes whitespace and avoids invalid material-name separators", () => {
  assert.equal(materialCopyTitle("  A\t  B / C\\D  "), "A B \uFF0F C\uFF3CD");
  assert.equal(materialCopyTitle("https://example.com/path"), "https:\uFF0F\uFF0Fexample.com\uFF0Fpath");
});

test("limits long titles to 120 code points without splitting surrogate pairs", () => {
  assert.equal(materialCopyTitle("A".repeat(120)), "A".repeat(120));
  assert.equal(materialCopyTitle("A".repeat(121)), `${"A".repeat(119)}\u2026`);
  const title = materialCopyTitle("\u{1F600}".repeat(121));
  assert.equal(Array.from(title).length, 120);
  assert.equal(title, `${"\u{1F600}".repeat(119)}\u2026`);
});
