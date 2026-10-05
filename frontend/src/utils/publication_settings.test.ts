import assert from "node:assert/strict";
import test from "node:test";
import { publicationSettingsIssue, type PublicationSettingsValues } from "./publication_settings.ts";

const now = new Date(2026, 9, 4, 12);
const valid: PublicationSettingsValues = {
  platform: "douyin", accountId: "account",
  accounts: [{ id: "account", platform: "douyin" }],
  scheduledFor: "2026-10-05T10:30", mediaMode: "image_text", contentCount: 1, videoCount: 0,
};
const issue = (changes: Partial<PublicationSettingsValues>) => publicationSettingsIssue({ ...valid, ...changes }, now);

test("an entirely empty form asks for a channel, not unsupported-platform or content feedback", () => {
  assert.equal(issue({
    platform: "", accountId: "", accounts: [], scheduledFor: "", contentCount: 0,
  }), "missing-channel");
});

test("an explicitly unsupported channel is distinct from an unselected channel", () => {
  assert.equal(issue({ platform: "xiaohongshu", accountId: "", accounts: [] }), "unsupported-channel");
});

test("account feedback distinguishes connecting, selecting and replacing an account", () => {
  assert.equal(issue({ accountId: "", accounts: [] }), "no-accounts");
  assert.equal(issue({ accountId: "" }), "missing-account");
  assert.equal(issue({ accountId: "removed" }), "unavailable-account");
  assert.equal(issue({ accounts: [{ id: "account", platform: "xiaohongshu" }] }), "unavailable-account");
});

test("incomplete dates and times are reported before missing content", () => {
  for (const scheduledFor of ["", "2026-10-05T", "T10:30"]) {
    assert.equal(issue({ scheduledFor, contentCount: 0 }), "missing-schedule");
  }
});

test("complete but invalid or nonfuture schedules have specific validation feedback", () => {
  for (const scheduledFor of ["2026-10-04T18:00", "2026-10-03T12:00", "2026-10-05T25:00", "2026-10-05T10:70"]) {
    assert.equal(issue({ scheduledFor }), "invalid-schedule");
  }
});

test("content validation preserves image/copy and exactly-one-video requirements", () => {
  assert.equal(issue({ contentCount: 0 }), "missing-content");
  assert.equal(issue({ mediaMode: "video", contentCount: 0, videoCount: 0 }), "invalid-video");
  assert.equal(issue({ mediaMode: "video", contentCount: 2, videoCount: 2 }), "invalid-video");
  assert.equal(issue({ mediaMode: "video", videoCount: 0 }), "invalid-video");
});

test("complete valid settings do not produce a blocking reason", () => {
  assert.equal(issue({}), null);
  assert.equal(issue({ mediaMode: "video", videoCount: 1 }), null);
  assert.equal(issue({ mediaMode: "video", contentCount: 2, videoCount: 1 }), null);
});
