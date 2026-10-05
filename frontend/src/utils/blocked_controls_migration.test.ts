import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const sourceRoot = fileURLToPath(new URL("../", import.meta.url));

function sourceFiles(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const filename = path.join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(filename)
      : filename.endsWith(".tsx") && !filename.endsWith(".test.tsx") ? [filename] : [];
  });
}

test("visible native controls no longer use silent disabled attributes", () => {
  const violations: string[] = [];
  for (const filename of sourceFiles(sourceRoot)) {
    const source = ts.createSourceFile(filename, fs.readFileSync(filename, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const visit = (node: ts.Node) => {
      if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
        const tag = node.tagName.getText(source);
        if (["button", "input", "textarea", "select", "option"].includes(tag)) {
          const attributes = node.attributes.properties.filter(ts.isJsxAttribute);
          const disabled = attributes.some((attribute) => attribute.name.getText(source) === "disabled");
          const valueOf = (name: string) => attributes.find((attribute) => attribute.name.getText(source) === name)?.initializer;
          const disabledValue = valueOf("disabled");
          const typeValue = valueOf("type");
          const styleValue = valueOf("style");
          const style = styleValue && ts.isJsxExpression(styleValue) ? styleValue.expression : undefined;
          const pointer = style && ts.isObjectLiteralExpression(style)
            ? style.properties.find((property) => ts.isPropertyAssignment(property) && property.name.getText(source) === "pointerEvents")
            : undefined;
          const pointerValue = pointer && ts.isPropertyAssignment(pointer) ? pointer.initializer : undefined;
          let parent = node.parent;
          let guardedUploadLabel = false;
          while (parent) {
            if (ts.isJsxElement(parent) && parent.openingElement.tagName.getText(source) === "label") {
              const props = parent.openingElement.attributes.properties.filter(ts.isJsxAttribute);
              const names = new Set(props.map((attribute) => attribute.name.getText(source)));
              const className = props.find((attribute) => attribute.name.getText(source) === "className")?.initializer;
              guardedUploadLabel = Boolean(className?.getText(source).includes("amp-insight-upload")
                && ["onClickCapture", "onKeyDownCapture", "aria-disabled", "data-blocked-action", "role", "tabIndex"].every((name) => names.has(name)));
              break;
            }
            parent = parent.parent;
          }
          const guardedOverlay = tag === "input" && typeValue && ts.isStringLiteral(typeValue) && typeValue.text === "file"
            && guardedUploadLabel && disabledValue && ts.isJsxExpression(disabledValue) && disabledValue.expression
            && pointerValue && ts.isConditionalExpression(pointerValue)
            && ts.isStringLiteral(pointerValue.whenTrue) && pointerValue.whenTrue.text === "none"
            && pointerValue.condition.getText(source) === disabledValue.expression.getText(source);
          const hidden = attributes.some((attribute) => {
            const name = attribute.name.getText(source);
            const value = attribute.initializer;
            return name === "hidden" && (!value || ts.isJsxExpression(value) && value.expression?.kind === ts.SyntaxKind.TrueKeyword)
              || name === "type" && value && ts.isStringLiteral(value) && value.text === "hidden"
              || name === "className" && value && ts.isStringLiteral(value) && value.text.split(/\s+/).includes("hidden");
          });
          if (disabled && !hidden && !guardedOverlay) {
            const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
            violations.push(`${path.relative(sourceRoot, filename)}:${line} <${tag}>`);
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  assert.deepEqual(violations, [], `Use guarded controls with a localized reason:\n${violations.join("\n")}`);
});
