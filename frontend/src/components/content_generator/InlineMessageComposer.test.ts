import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = readFileSync(new URL("./InlineMessageComposer.tsx", import.meta.url), "utf8");
const file = ts.createSourceFile("InlineMessageComposer.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let effect: ts.ArrowFunction | undefined;
function findEffect(node: ts.Node) {
  if (ts.isCallExpression(node) && node.expression.getText(file) === "useEffect"
    && node.arguments[0] && ts.isArrowFunction(node.arguments[0])) effect = node.arguments[0];
  ts.forEachChild(node, findEffect);
}
findEffect(file);

test("sending clears the editor immediately even when it becomes disabled", () => {
  assert.ok(effect);
  const body = effect.body;
  assert.ok(ts.isBlock(body));
  const script = ts.transpile(body.getText(file), { target: ts.ScriptTarget.ES2022 });
  const synchronize = new Function("editor", "previousText", "selection", "value", "disabled", script);
  const root = { textContent: "标题改一下" };
  const previousText = { current: "标题改一下" };
  const selection = { current: {} as object | null };
  synchronize({ current: root }, previousText, selection, "", true);
  assert.equal(root.textContent, "");
  assert.equal(previousText.current, "");
  assert.equal(selection.current, null);
});

test("a disabled editor keeps an unchanged draft intact", () => {
  assert.ok(effect);
  const body = effect.body;
  assert.ok(ts.isBlock(body));
  const synchronize = new Function("editor", "previousText", "selection", "value", "disabled",
    ts.transpile(body.getText(file), { target: ts.ScriptTarget.ES2022 }));
  const root = { textContent: "Draft with reference" };
  const selection = { current: {} };
  const originalSelection = selection.current;
  synchronize({ current: root }, { current: root.textContent }, selection, root.textContent, true);
  assert.equal(root.textContent, "Draft with reference");
  assert.equal(selection.current, originalSelection);
});
