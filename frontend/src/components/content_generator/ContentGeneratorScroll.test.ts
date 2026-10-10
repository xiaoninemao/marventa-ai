import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = readFileSync(new URL("./ContentGeneratorExperience.tsx", import.meta.url), "utf8");
const file = ts.createSourceFile("ContentGeneratorExperience.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let effect: ts.ArrowFunction | undefined;
let scroll: ts.ArrowFunction | undefined;
function findCallbacks(node: ts.Node) {
  if (ts.isCallExpression(node) && node.expression.getText(file) === "useLayoutEffect"
    && node.arguments[0] && ts.isArrowFunction(node.arguments[0])
    && node.arguments[0].getText(file).includes("chat_messages_ref.current")) effect = node.arguments[0];
  if (ts.isJsxAttribute(node) && node.name.getText(file) === "onScroll"
    && node.initializer && ts.isJsxExpression(node.initializer)
    && node.initializer.expression && ts.isArrowFunction(node.initializer.expression)) scroll = node.initializer.expression;
  ts.forEachChild(node, findCallbacks);
}
findCallbacks(file);

function root(top: number, height = 1000, viewport = 300) {
  return {
    scrollHeight: height, clientHeight: viewport, position: top,
    get scrollTop() { return this.position; },
    set scrollTop(value: number) { this.position = Math.max(0, Math.min(value, this.scrollHeight - this.clientHeight)); },
  };
}

function synchronize(element: ReturnType<typeof root>, following: boolean, previous = element, savedTop = element.scrollTop) {
  assert.ok(effect && ts.isBlock(effect.body));
  const execute = new Function("chat_messages_ref", "follow_latest_ref", "chat_scroll_top_ref", "last_chat_root_ref",
    ts.transpile(effect.body.getText(file), { target: ts.ScriptTarget.ES2022 }));
  const position = { current: savedTop };
  execute({ current: element }, { current: following }, position, { current: previous });
  return position.current;
}

test("background message refreshes and streaming growth leave a paused reader in place", () => {
  const element = root(275);
  synchronize(element, false);
  element.scrollHeight += 500;
  synchronize(element, false);
  assert.equal(element.scrollTop, 275);
});

test("readers at the bottom continue following new content", () => {
  const element = root(700);
  element.scrollHeight = 1500;
  synchronize(element, true);
  assert.equal(element.scrollTop, 1200);
});

test("remounting the chat tab restores its reading position instead of jumping to latest", () => {
  const previous = root(275);
  const mounted = root(0);
  assert.equal(synchronize(mounted, false, previous, 275), 275);
  assert.equal(mounted.scrollTop, 275);
});

test("manual scrolling pauses following outside the 48px bottom threshold", () => {
  assert.ok(scroll && ts.isBlock(scroll.body));
  const execute = new Function("event", "chat_scroll_top_ref", "follow_latest_ref",
    ts.transpile(scroll.body.getText(file), { target: ts.ScriptTarget.ES2022 }));
  const following = { current: true };
  const position = { current: 0 };
  execute({ currentTarget: root(651) }, position, following);
  assert.equal(following.current, false);
  assert.equal(position.current, 651);
  execute({ currentTarget: root(652) }, position, following);
  assert.equal(following.current, true);
});

test("chat follow uses the scroll pane rather than scrolling surrounding page ancestors", () => {
  assert.doesNotMatch(source, /chat_end_ref|scrollIntoView\(\{ behavior: "smooth" \}\)/);
  assert.match(source, /onScroll=\{event =>/);
});
