import assert from "node:assert/strict";
import test from "node:test";
import { CHINESE_ACTIONS, CHINESE_FEEDBACK, CHINESE_PROGRESS, ENGLISH_ACTIONS, ENGLISH_FEEDBACK, ENGLISH_PROGRESS } from "./interaction_copy.ts";
import { translate } from "./locale.ts";

test("English action labels use one concise canonical form", () => {
  assert.equal(ENGLISH_ACTIONS.create, "Create");
  assert.equal(ENGLISH_ACTIONS.save, "Save");
  assert.equal(ENGLISH_ACTIONS.edit, "Edit");
  assert.equal(ENGLISH_ACTIONS.rename, "Rename");
  assert.equal(ENGLISH_ACTIONS.delete, "Delete");
  assert.equal(ENGLISH_ACTIONS.cancel, "Cancel");
  assert.equal(ENGLISH_ACTIONS.confirm, "Confirm");
  assert.equal(ENGLISH_ACTIONS.select, "Select");
  for (const value of Object.values(ENGLISH_ACTIONS)) {
    assert.equal(value, value.trim());
    assert.doesNotMatch(value, /^(?:Create|New|Save|Delete|Rename) .+/);
  }
});

test("busy captions use consistent progress wording and punctuation", () => {
  assert.equal(ENGLISH_PROGRESS.creating, "Creating...");
  assert.equal(ENGLISH_PROGRESS.saving, "Saving...");
  assert.equal(ENGLISH_PROGRESS.generating, "Generating...");
  for (const value of Object.values(ENGLISH_PROGRESS)) {
    assert.match(value, /^[A-Z].+\.\.\.$/);
    assert.doesNotMatch(value, /…/);
  }
});

test("canonical actions use the same concise meaning in both languages", () => {
  assert.equal(translate("en", CHINESE_ACTIONS.create, ENGLISH_ACTIONS.create), "Create");
  assert.equal(translate("zh-CN", CHINESE_ACTIONS.create, ENGLISH_ACTIONS.create), "创建");
  assert.equal(translate("zh-CN", CHINESE_ACTIONS.save, ENGLISH_ACTIONS.save), "保存");
  assert.deepEqual(Object.keys(CHINESE_ACTIONS), Object.keys(ENGLISH_ACTIONS));
  assert.deepEqual(Object.keys(CHINESE_PROGRESS), Object.keys(ENGLISH_PROGRESS));
  assert.deepEqual(Object.keys(CHINESE_FEEDBACK), Object.keys(ENGLISH_FEEDBACK));
});

test("Chinese actions and progress labels do not add redundant target nouns", () => {
  assert.equal(CHINESE_ACTIONS.create, "创建");
  assert.equal(CHINESE_ACTIONS.save, "保存");
  assert.equal(CHINESE_PROGRESS.creating, "创建中…");
  assert.equal(CHINESE_PROGRESS.saving, "保存中…");
  for (const value of Object.values(CHINESE_PROGRESS)) assert.match(value, /中…$/);
  assert.deepEqual(CHINESE_FEEDBACK, { success: "成功", notice: "提示", working: "处理中", error: "失败" });
});

test("toast headings use concise consistent feedback terms", () => {
  assert.deepEqual(ENGLISH_FEEDBACK, {
    success: "Success", notice: "Notice", working: "Working", error: "Error",
  });
});
