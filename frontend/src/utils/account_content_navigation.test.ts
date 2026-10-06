import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { accountContentSourceHref, parseAccountContentSource } from "./account_content_navigation.ts";

test("source defaults stay platform while explicit saved records survive bookmarking and refresh", () => {
  assert.equal(parseAccountContentSource(null), "platform");
  assert.equal(parseAccountContentSource("platform"), "platform");
  assert.equal(parseAccountContentSource("marventa"), "marventa");
  const href = accountContentSourceHref("project=project-a&account=account-a", "marventa");
  const url = new URL(href, "http://localhost:3000");
  assert.equal(url.searchParams.get("project"), "project-a");
  assert.equal(url.searchParams.get("account"), "account-a");
  assert.equal(parseAccountContentSource(url.searchParams.get("source")), "marventa");
  assert.equal(new URL(accountContentSourceHref(url.search.slice(1), "platform"), url.origin).searchParams.get("source"), "platform");
});

test("unsupported source queries are rejected explicitly instead of loading a different source", () => {
  for (const value of ["", "all", "unknown", "marventa&source=platform"]) assert.equal(parseAccountContentSource(value), null);
  const page = readFileSync(new URL("../app/account_content/page.tsx", import.meta.url), "utf8");
  assert.match(page, /if \(!user \|\| !account \|\| !source\) return/);
  assert.match(page, /内容来源无效/);
  assert.match(page, /pagingSource === source \? storedCursors : \["0"\]/);
  assert.match(page, /pagingSource === source \? storedPageIndex : 0/);
  assert.match(page, /if \(pagingSource !== source\) setCursors\(\["0"\]\)/);
});
