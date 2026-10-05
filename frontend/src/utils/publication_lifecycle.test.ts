import assert from "node:assert/strict";
import test from "node:test";
import { publicationHasScheduledRelease, publicationNeedsPolling, publicationPublishedNotice, publicationReadOnly } from "./publication_lifecycle.ts";

test("scheduled, publishing and published plans prohibit mutations until scheduling is cancelled", () => {
  for (const status of ["scheduled", "publishing", "published"]) assert.equal(publicationReadOnly(status), true);
  for (const status of ["draft", "cancelled", "failed"]) assert.equal(publicationReadOnly(status), false);
});

test("scheduled and publishing plans refresh until execution reaches a terminal status", () => {
  for (const status of ["scheduled", "publishing"]) assert.equal(publicationNeedsPolling(status), true);
  for (const status of ["draft", "published", "cancelled", "failed"]) assert.equal(publicationNeedsPolling(status), false);
});

test("cancel publication is available only for a saved scheduled release", () => {
  const time = "2026-10-01T10:00:00Z";
  assert.equal(publicationHasScheduledRelease("scheduled", time), true);
  for (const status of ["draft", "cancelled", "failed", "publishing", "published"]) {
    assert.equal(publicationHasScheduledRelease(status, time), false);
    assert.equal(publicationHasScheduledRelease(status, ""), false);
  }
  assert.equal(publicationHasScheduledRelease("scheduled", ""), false);
  assert.equal(publicationHasScheduledRelease("scheduled", "   "), false);
});

test("published result means accepted creation, not confirmed public visibility", () => {
  const notice = publicationPublishedNotice("published");
  assert.ok(notice);
  assert.match(notice.en, /accepted the creation request/);
  assert.match(notice.en, /Review and visibility are subject to the platform/);
  assert.match(notice.en, /does not mean the post is publicly visible/);
  assert.match(notice.zh, /平台已接受创建请求/);
  assert.match(notice.zh, /审核和展示由平台决定/);
  assert.match(notice.zh, /不代表已公开可见/);
});

test("non-published outcomes do not show an accepted-creation result", () => {
  for (const status of ["draft", "scheduled", "publishing", "cancelled", "failed"]) {
    assert.equal(publicationPublishedNotice(status), null);
  }
});
