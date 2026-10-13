import assert from "node:assert/strict";
import test from "node:test";
import { hasBriefPrompt } from "./creationBrief";

test("each untouched multi-select prompt stays selected", () => {
  const benefits = "请帮我梳理产品的核心卖点：";
  const audience = "这次内容的目标受众是：";
  const platform = "我准备发布的平台和内容形式是：";
  const message = `${benefits}\n\n${audience}`;
  assert.equal(hasBriefPrompt(message, benefits), true);
  assert.equal(hasBriefPrompt(message, audience), true);
  assert.equal(hasBriefPrompt(message, platform), false);
});

test("editing or extending a prompt deselects only that card", () => {
  const benefits = "请帮我梳理产品的核心卖点：";
  const audience = "这次内容的目标受众是：";
  const message = `${benefits}智能营销 Agent\n\n${audience}`;
  assert.equal(hasBriefPrompt(message, benefits), false);
  assert.equal(hasBriefPrompt(message, audience), true);
  assert.equal(hasBriefPrompt("请帮我梳理产品核心卖点：", benefits), false);
  assert.equal(hasBriefPrompt(`请介绍${benefits}`, benefits), false);
});
