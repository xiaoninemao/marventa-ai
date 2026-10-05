import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = fileURLToPath(new URL("../", import.meta.url));
const actionElements = new Set(["button", "GuardedButton", "RedesignButton", "summary", "Link", "a"]);

function files(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const filename = path.join(directory, entry.name);
    return entry.isDirectory() ? files(filename)
      : filename.endsWith(".tsx") && !filename.endsWith(".test.tsx") ? [filename] : [];
  });
}

function isActionCaption(node: ts.Node, source: ts.SourceFile): boolean {
  let parent = node.parent;
  while (parent) {
    if (ts.isJsxAttribute(parent)) {
      return ["confirmLabel", "cancelLabel", "busyLabel"].includes(parent.name.getText(source));
    }
    if (ts.isJsxElement(parent)) {
      const tag = parent.openingElement.tagName.getText(source);
      if (actionElements.has(tag)) return true;
      if (["h1", "h2", "h3", "h4", "p", "label"].includes(tag)) return false;
    }
    parent = parent.parent;
  }
  return false;
}

test("visible primary action captions do not regress to expanded English labels", () => {
  const violations: string[] = [];
  for (const filename of files(root)) {
    const source = ts.createSourceFile(filename, fs.readFileSync(filename, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node) && node.expression.getText(source) === "t") {
        const english = node.arguments[1];
        if (english && ts.isStringLiteral(english) && isActionCaption(node, source)
          && /^(?:Create|New|Save|Rename|Delete) .+/.test(english.text)) {
          const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
          violations.push(`${path.relative(root, filename)}:${line} ${english.text}`);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  assert.deepEqual(violations, [], `Use the shared concise action labels:\n${violations.join("\n")}`);
});

test("shared action captions pair the same canonical Chinese and English keys", () => {
  const groups: Record<string, string> = {
    ENGLISH_ACTIONS: "CHINESE_ACTIONS",
    ENGLISH_PROGRESS: "CHINESE_PROGRESS",
    ENGLISH_FEEDBACK: "CHINESE_FEEDBACK",
  };
  const violations: string[] = [];
  for (const filename of files(root)) {
    const source = ts.createSourceFile(filename, fs.readFileSync(filename, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node) && node.expression.getText(source) === "t") {
        const english = node.arguments[1];
        const chinese = node.arguments[0];
        if (english && ts.isPropertyAccessExpression(english) && ts.isIdentifier(english.expression)) {
          const group = groups[english.expression.text];
          if (group && (!chinese || chinese.getText(source) !== `${group}.${english.name.text}`)) {
            const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
            violations.push(`${path.relative(root, filename)}:${line}`);
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  assert.deepEqual(violations, [], `Use matching bilingual action keys:\n${violations.join("\n")}`);
});
