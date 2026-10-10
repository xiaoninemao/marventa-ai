import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import type { SessionRecord } from "../../types/content_generator";

const source = readFileSync(new URL("./ContentGeneratorExperience.tsx", import.meta.url), "utf8");
const file = ts.createSourceFile("ContentGeneratorExperience.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let callback: ts.ArrowFunction | undefined;
function findFilter(node: ts.Node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(file) === "filtered_sessions"
    && node.initializer && ts.isCallExpression(node.initializer)
    && node.initializer.arguments[0] && ts.isArrowFunction(node.initializer.arguments[0])) {
    callback = node.initializer.arguments[0];
  }
  ts.forEachChild(node, findFilter);
}
findFilter(file);

function creation(id: string, kind?: SessionRecord["creation_kind"], status: SessionRecord["status"] = "drafting"): SessionRecord {
  return {
    id, title: id, creation_kind: kind, status, user_id: "user", project_id: "project", messages: [],
    insight_ids: [], case_ids: [], created_at: "2026-10-10T00:00:00Z", updated_at: "2026-10-10T00:00:00Z",
  };
}

function filter(sessions: SessionRecord[], kind = "all", status = "all", query = "", sort = "name"): SessionRecord[] {
  assert.ok(callback && ts.isBlock(callback.body));
  const execute = new Function("sessions", "type_filter", "status_filter", "filter_text", "locale", "sort_order",
    ts.transpile(callback.body.getText(file), { target: ts.ScriptTarget.ES2022 }));
  return execute(sessions, kind, status, query, "en", sort);
}

test("creation type filter distinguishes image and video while preserving legacy image drafts", () => {
  const sessions = [creation("image", "image"), creation("video", "video"), creation("legacy")];
  assert.deepEqual(filter(sessions, "image").map(item => item.id), ["image", "legacy"]);
  assert.deepEqual(filter(sessions, "video").map(item => item.id), ["video"]);
  assert.equal(filter(sessions).length, 3);
  assert.deepEqual(sessions.map(item => item.id), ["image", "video", "legacy"]);
});

test("type selection composes with status, title search and existing sorting", () => {
  const sessions = [
    creation("Video draft", "video"), creation("Video ready", "video", "completed"),
    creation("Image ready", "image", "completed"),
  ];
  assert.deepEqual(filter(sessions, "video", "completed", " READY ").map(item => item.id), ["Video ready"]);
  assert.deepEqual(filter(sessions, "image", "drafting"), []);
  const newer = { ...sessions[0], updated_at: "2026-10-11T00:00:00Z" };
  assert.deepEqual(filter([sessions[1], newer], "video", "all", "", "newest").map(item => item.id), ["Video draft", "Video ready"]);
  assert.deepEqual(filter([sessions[1], newer], "video", "all", "", "oldest").map(item => item.id), ["Video ready", "Video draft"]);
});

test("type selector follows the case-library status/type/sort layout and resets pagination", () => {
  const toolbar = source.split('<div className="amp-insight-toolbar">')[1]?.split("{session_loading ?")[0];
  assert.ok(toolbar);
  assert.ok(toolbar.indexOf("value={status_filter}") < toolbar.indexOf("value={type_filter}"));
  assert.ok(toolbar.indexOf("value={type_filter}") < toolbar.indexOf("value={sort_order}"));
  assert.match(toolbar, /ariaLabel=\{t\("类型", "Type"\)\}/);
  assert.match(source, /paginationResetKey = JSON\.stringify\(\[[^\]]*type_filter/);
  assert.match(source, /\[sessions, filter_text, locale, sort_order, status_filter, type_filter\]/);
  assert.match(source, /has_active_filters \? t\("没有匹配的创作"/);
});
