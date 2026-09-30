import test from "node:test";
import assert from "node:assert/strict";
import { get_card_content_format, get_card_preview_content } from "./contentGeneratorCardDetails.ts";
import type { ContentCard } from "../../types/content_generator.ts";

function card(fields: Partial<ContentCard>): ContentCard {
  return { id: "test-card", card_type: "script", title: "", preview: "", content: "", tips: [], ...fields };
}

test("Chinese and English canonical script titles preserve their content format", () => {
  for (const title of ["视频分镜脚本", "Video storyboard", " VIDEO STORYBOARD "]) {
    assert.equal(get_card_content_format(card({ title, content: "Cover image and carousel" })), "short_video");
  }
  for (const title of ["图文发布计划", "Image-text publishing plan"]) {
    assert.equal(get_card_content_format(card({ title, content: "Video storyboard and voiceover" })), "image_text");
  }
});

test("custom English video titles use case-insensitive evidence and preserve original preview content", () => {
  const video = card({
    title: "Product launch plan",
    preview: "SHORT VIDEO",
    content: "Storyboard: introduce the product.\nVoiceover: explain the key benefit.",
  });
  assert.equal(get_card_content_format(video), "short_video");
  assert.equal(get_card_preview_content(video), video.content);
});

test("content preview preserves all original lines, headings, numbering, indentation and blank lines", () => {
  const content = "发布形式：小红书图文\n\n图片顺序与文案搭配：\n"
    + Array.from({ length: 9 }, (_, index) => `  ${index + 1}. 第${index + 1}张图片与真实文案。`).join("\n")
    + "\n\n互动引导：这是正文的最后一部分。\n";
  const original = card({ content, preview: "Short overview", tips: ["Unrelated guidance"] });
  assert.equal(get_card_preview_content(original), content);
  assert.match(get_card_preview_content(original), /9\. 第9张/);
  assert.match(get_card_preview_content(original), /最后一部分/);
});

test("single paragraphs are not split at punctuation or relabeled", () => {
  const content = "Opening: keep this sentence. Detail: keep this sentence too! Closing: retain the actual labels.";
  assert.equal(get_card_preview_content(card({ content })), content);
});

test("empty content falls back to the actual preview, not invented content from tips", () => {
  assert.equal(get_card_preview_content(card({ content: "  ", preview: "  Actual preview\n", tips: ["Guidance"] })), "  Actual preview\n");
  assert.equal(get_card_preview_content(card({ content: " ", preview: "", tips: ["Guidance"] })), "");
});

test("English image-post content is not mistaken for a video plan", () => {
  assert.equal(get_card_content_format(card({
    title: "Launch campaign",
    content: "CAROUSEL: outline the image sequence, cover image, and post copy.",
  })), "image_text");
});

test("legacy Chinese evidence and ambiguous-content fallback remain supported", () => {
  assert.equal(get_card_content_format(card({ content: "短视频分镜和口播台词" })), "short_video");
  assert.equal(get_card_content_format(card({ content: "图文正文和封面图" })), "image_text");
  assert.equal(get_card_content_format(card({ content: "A general campaign outline" })), "image_text");
});
