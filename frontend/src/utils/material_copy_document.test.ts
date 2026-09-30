import assert from "node:assert/strict";
import test from "node:test";
import { materialCopyDocument } from "./material_copy_document.ts";

test("full and thumbnail previews preserve the same formatted source content", () => {
  const content = "<h2>Plan</h2><p><strong>Real copy</strong> &amp; details</p><ul><li>First item</li></ul>";
  for (const thumbnail of [false, true]) {
    const document = materialCopyDocument(content, thumbnail);
    assert.ok(document.endsWith(`<body>${content}</body></html>`));
    assert.ok(document.includes("default-src 'none'; style-src 'unsafe-inline'"));
    assert.ok(document.includes('charset="utf-8"'));
    assert.equal(document.includes("font-size:10px"), thumbnail);
  }
});

test("preview spacing does not add browser margins or modify source blank lines", () => {
  const content = "<p>\n\nCopy with source blank lines</p>";
  const full = materialCopyDocument(content);
  assert.ok(full.includes("body{margin:0;"));
  assert.ok(full.includes("body>:first-child{margin-top:0}"));
  assert.ok(full.endsWith(`<body>${content}</body></html>`));
  assert.ok(materialCopyDocument(content, true).includes("padding:28px 6px 6px"));
});

test("full preview uses compact line height and explicit paragraph spacing", () => {
  const document = materialCopyDocument("<p>First</p><p>Second</p>");
  assert.ok(document.includes("font:16px/1.5"));
  assert.ok(document.includes("p{margin:0 0 8px;white-space:pre-wrap}"));
});
