import assert from "node:assert/strict";
import test from "node:test";
import { insertPublicationImage, movePublicationImage, validatePublicationMediaFiles } from "./publication_media.ts";

test("video mode accepts exactly one video and rejects images or additional videos", () => {
  validatePublicationMediaFiles("video", 0, ["clip.MP4"]);
  assert.throws(() => validatePublicationMediaFiles("video", 0, ["image.jpg"]), /only accepts video/);
  assert.throws(() => validatePublicationMediaFiles("video", 0, ["a.mov", "b.mp4"]), /Only one video/);
  assert.throws(() => validatePublicationMediaFiles("video", 1, ["clip.mp4"]), /Only one video/);
});

test("image-text accepts multiple images in order but no video or document", () => {
  validatePublicationMediaFiles("image_text", 12, ["cover.PNG", "second.webp", "third.gif"]);
  assert.throws(() => validatePublicationMediaFiles("image_text", 0, ["a.png", "video.mp4"]), /only accepts images/);
  assert.throws(() => validatePublicationMediaFiles("image_text", 0, ["copy.md"]), /only accepts images/);
});

test("image-text has no total image count or upload selection cap", () => {
  validatePublicationMediaFiles(
    "image_text",
    1000,
    Array.from({ length: 101 }, (_, index) => `image-${index}.png`),
  );
});

test("image reordering moves only the chosen image and preserves the source", () => {
  const ids = ["first", "second", "third"];
  assert.deepEqual(movePublicationImage(ids, "second", -1), ["second", "first", "third"]);
  assert.deepEqual(movePublicationImage(ids, "second", 1), ["first", "third", "second"]);
  assert.deepEqual(ids, ["first", "second", "third"]);
  assert.equal(movePublicationImage(ids, "first", -1), ids);
  assert.equal(movePublicationImage(ids, "third", 1), ids);
  assert.equal(movePublicationImage(ids, "missing", 1), ids);
});

test("drag insertion accepts every gap, including before the first and after the last image", () => {
  const ids = ["a", "b", "c", "d"];
  assert.deepEqual(insertPublicationImage(ids, "c", 0), ["c", "a", "b", "d"]);
  assert.deepEqual(insertPublicationImage(ids, "a", 2), ["b", "a", "c", "d"]);
  assert.deepEqual(insertPublicationImage(ids, "a", 3), ["b", "c", "a", "d"]);
  assert.deepEqual(insertPublicationImage(ids, "a", 4), ["b", "c", "d", "a"]);
  assert.deepEqual(insertPublicationImage(ids, "d", 1), ["a", "d", "b", "c"]);
  assert.deepEqual(ids, ["a", "b", "c", "d"]);
  assert.equal(insertPublicationImage(ids, "b", 1), ids);
  assert.equal(insertPublicationImage(ids, "b", 2), ids);
  assert.equal(insertPublicationImage(ids, "missing", 0), ids);
  assert.equal(insertPublicationImage(ids, "a", -1), ids);
  assert.equal(insertPublicationImage(ids, "a", 5), ids);
  assert.equal(insertPublicationImage(ids, "a", 1.5), ids);
});
