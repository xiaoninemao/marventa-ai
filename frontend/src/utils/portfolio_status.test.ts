import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import type { PortfolioScript } from "../types/portfolio";
import { portfolioWorkStatus } from "./portfolio_status";

function work(id: string, kind: PortfolioScript["media_kind"], hasMedia = false): PortfolioScript {
  return {
    id, name: id, title: id, user_id: "user", project_id: "project", project_title: "Project", project_role: "owner",
    status: "completed", content: "", source_session_id: "", media_kind: kind,
    created_at: "2026-10-10T00:00:00Z", updated_at: "2026-10-10T00:00:00Z",
    media: hasMedia && kind ? [{
      id: "media", name: "media", media_type: kind, object_key: "media", mime_type: "", file_url: "/media",
    }] : [],
  };
}

test("native portfolio progress reflects media presence rather than the persisted save status", () => {
  for (const kind of ["image", "video"] as const) {
    assert.equal(portfolioWorkStatus(work("empty", kind)), "draft");
    const copyOnly = { ...work("copy-only", kind), content: "Copy" };
    assert.equal(portfolioWorkStatus(copyOnly), "draft");
    assert.equal(portfolioWorkStatus(work("media-only", kind, true)), "completed");
    assert.equal(portfolioWorkStatus({ ...work("removed", kind, true), media: [] }), "draft");
  }
});

test("historical text and processing failures retain their meaning", () => {
  const archive = { ...work("archive", null), content: "Historical report" };
  assert.equal(portfolioWorkStatus(archive), "draft");
  assert.equal(portfolioWorkStatus(work("empty archive", null)), "draft");
  assert.equal(portfolioWorkStatus({ ...work("processing", "image"), status: "generating" }), "generating");
  assert.equal(portfolioWorkStatus({ ...work("failed", "video", true), status: "failed" }), "failed");
});

const source = readFileSync(new URL("../app/portfolio/page.tsx", import.meta.url), "utf8");
const file = ts.createSourceFile("portfolio.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let callback: ts.ArrowFunction | undefined;
function findFilter(node: ts.Node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(file) === "visibleScripts"
    && node.initializer && ts.isCallExpression(node.initializer)
    && node.initializer.arguments[0] && ts.isArrowFunction(node.initializer.arguments[0])) callback = node.initializer.arguments[0];
  ts.forEachChild(node, findFilter);
}
findFilter(file);

function filter(scripts: PortfolioScript[], typeFilter = "all", status = "all", query = "", sort = "name"): PortfolioScript[] {
  assert.ok(callback && ts.isBlock(callback.body));
  const execute = new Function("scripts", "typeFilter", "status", "query", "sort", "locale", "portfolioWorkStatus",
    ts.transpile(callback.body.getText(file), { target: ts.ScriptTarget.ES2022 }));
  return execute(scripts, typeFilter, status, query, sort, "en", portfolioWorkStatus);
}

test("type and progress combine with search and sorting without hiding text archives from all types", () => {
  const records = [work("Image draft", "image"), work("Image ready", "image", true),
    work("Video draft", "video"), work("Video ready", "video", true),
    { ...work("Archive", null), content: "Historical text" }];
  assert.deepEqual(filter(records, "image", "draft").map(item => item.id), ["Image draft"]);
  assert.deepEqual(filter(records, "video", "completed", " READY ").map(item => item.id), ["Video ready"]);
  assert.equal(filter(records).length, 5);
  assert.equal(filter(records, "all", "completed").length, 2);
  const newer = { ...records[0], updated_at: "2026-10-11T00:00:00Z" };
  assert.equal(filter([records[1], newer], "image", "all", "", "latest")[0].id, "Image draft");
  assert.equal(filter([records[1], newer], "image", "all", "", "oldest")[0].id, "Image ready");
});

test("portfolio name search and sorting are independent from the publication headline", () => {
  const records = [
    { ...work("z", "image"), name: "Alpha asset", title: "Zulu headline" },
    { ...work("a", "video", true), name: "Zulu asset", title: "Alpha headline" },
  ];
  assert.deepEqual(filter(records).map(item => item.name), ["Alpha asset", "Zulu asset"]);
  assert.equal(filter(records, "all", "all", "alpha asset")[0].title, "Zulu headline");
  assert.equal(filter(records, "all", "all", "alpha headline")[0].name, "Zulu asset");
});
test("type selection resets pagination and badges use the same progress classifier as filtering", () => {
  assert.match(source, /paginationResetKey = JSON\.stringify\(\[[^\]]*typeFilter/);
  assert.match(source, /const workStatus = portfolioWorkStatus\(script\)/);
  assert.match(source, /hasActiveFilters \? t\("没有匹配的作品"/);
  assert.doesNotMatch(source, /t\("生成中", "Generating"\)/);
  const toolbar = source.split('<div className="amp-insight-toolbar">')[1]?.split("{loading ?")[0];
  assert.ok(toolbar);
  assert.ok(toolbar.indexOf("value={status}") < toolbar.indexOf("value={typeFilter}"));
  assert.ok(toolbar.indexOf("value={typeFilter}") < toolbar.indexOf("value={sort}"));
});
