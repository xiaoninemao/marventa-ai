import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const projectDetailSource = readFileSync(
  new URL("../../app/projects/[projectId]/page.tsx", import.meta.url),
  "utf8",
);
const projectListSource = readFileSync(
  new URL("../../app/projects/page.tsx", import.meta.url),
  "utf8",
);

test("brand guidelines live in a dedicated project guidelines tab", () => {
  assert.match(projectDetailSource, /tab === "guidelines"/);
  assert.match(projectDetailSource, /setTab\("guidelines"\)/);
  assert.match(projectDetailSource, /规范", "Guidelines"/);
  assert.match(projectDetailSource, /品牌与创作规范/);
  assert.match(projectDetailSource, /persistBrandGuidelines/);
  assert.match(projectDetailSource, /brand_profile:/);
  assert.match(projectDetailSource, /正在自动保存/);
  assert.match(projectDetailSource, /brandSaveQueuedRef/);
  assert.match(projectDetailSource, /setTimeout\(\(\) => \{/);
  assert.match(projectDetailSource, /}, 700\)/);
  assert.doesNotMatch(projectDetailSource, /project-brand-guidelines-form|保存更改/);
  assert.doesNotMatch(projectListSource, /customBrandTone|amp-project-brand-guidelines/);
});

test("project members can view guidelines but only managers can edit them", () => {
  assert.match(projectDetailSource, /const canManageMembers = project\.role === "owner" \|\| project\.role === "admin"/);
  assert.match(projectDetailSource, /disabled=\{!canManageMembers\}/);
  assert.match(projectDetailSource, /仅项目所有者或管理员可以修改品牌规范/);
});
