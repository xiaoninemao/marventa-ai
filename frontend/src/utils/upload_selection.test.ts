import assert from "node:assert/strict";
import test from "node:test";
import { selectUploadFiles } from "./upload_selection.ts";

const file = (name: string) => new File(["content"], name, { lastModified: 1 });

test("reselecting an image or video reports a duplicate and preserves the original", () => {
  for (const [name, limit] of [["image.png", 10], ["video.mp4", 1]] as const) {
    const original = file(name);
    const result = selectUploadFiles([original], [file(name)], limit);
    assert.deepEqual(result.duplicates, [name]);
    assert.equal(result.files.length, 1);
    assert.equal(result.files[0], original);
    assert.equal(result.limitExceeded, false);
  }
});

test("mixed selections retain new images and report duplicates", () => {
  const original = file("first.png");
  const added = file("second.png");
  const result = selectUploadFiles([original], [file("first.png"), added, added], 10);
  assert.deepEqual(result.files, [original, added]);
  assert.deepEqual(result.duplicates, ["first.png", "second.png"]);
});

test("full image selections and a second video never replace existing files", () => {
  for (const limit of [1, 10]) {
    const originals = Array.from({ length: limit }, (_, i) => file(`${i}.png`));
    const result = selectUploadFiles(originals, [file("new.png")], limit);
    assert.deepEqual(result.files, originals);
    assert.equal(result.limitExceeded, true);
  }
});

test("cancelling selection preserves files and removal allows reselecting", () => {
  const original = file("image.png");
  assert.deepEqual(selectUploadFiles([original], [], 10).files, [original]);
  assert.deepEqual(selectUploadFiles([], [original], 10).duplicates, []);
});

test("document selections allow one file and preserve it on duplicate or additional selections", () => {
  const original = file("brief.pdf");
  const added = file("notes.docx");
  const result = selectUploadFiles([original], [file("brief.pdf"), added], 1);
  assert.deepEqual(result.files, [original]);
  assert.deepEqual(result.duplicates, ["brief.pdf"]);
  assert.equal(result.limitExceeded, true);
  const batch = selectUploadFiles([], [original, added], 1);
  assert.deepEqual(batch.files, [original]);
  assert.equal(batch.limitExceeded, true);
  assert.deepEqual(selectUploadFiles([original], [], 1).files, [original]);
  assert.deepEqual(selectUploadFiles([], [added], 1).files, [added]);
});
