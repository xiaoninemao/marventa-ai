import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const css = readFileSync(new URL("../styles/projects.css", import.meta.url), "utf8");
const page = readFileSync(new URL("../app/projects/[projectId]/page.tsx", import.meta.url), "utf8");

function rule(selector: string) {
  const start = css.indexOf(`${selector} {`);
  assert.notEqual(start, -1);
  const open = css.indexOf("{", start);
  return css.slice(open + 1, css.indexOf("}", open));
}

test("material collection counts remain one row in narrow cards", () => {
  const selector = ".amp-redesign .amp-material-collection-meta";
  assert.match(rule(selector), /flex-wrap: nowrap/);
  assert.match(rule(`${selector} > span:first-child`), /flex: none/);
  const breakdown = rule(`${selector} > span:last-child`);
  assert.match(breakdown, /min-width: 0/);
  assert.match(breakdown, /white-space: nowrap/);
  assert.match(breakdown, /text-overflow: ellipsis/);
});

test("truncated type counts retain their complete localized text and tooltip", () => {
  assert.match(page, /<span title=\{collectionSummary\}>\{collectionSummary\}<\/span>/);
  assert.match(page, /images: material\.image_count, videos: material\.video_count, copy: material\.document_count/);
  assert.match(page, /图片 \{images\} · 视频 \{videos\} · 文案 \{copy\}/);
});
