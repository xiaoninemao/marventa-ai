import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const sourceRoot = fileURLToPath(new URL("../", import.meta.url));
type ActionMode = "confirm" | "view" | "composed" | "authorize" | "auth";
type Bindings = Record<string, boolean | string>;
type Variants = { variants: Array<{ mode: ActionMode; bindings: Bindings }> };
type Mode = ActionMode | Variants;

function editingModes(editing: string, bindings: Bindings = {}): Variants {
  return { variants: [
    { mode: "view", bindings: { ...bindings, [editing]: false } },
    { mode: "confirm", bindings: { ...bindings, [editing]: true } },
  ] };
}

const dialogModes: Record<string, Mode> = {
  "app/projects/page.tsx:create-project-title": "confirm",
  "app/projects/page.tsx:customize-project-title": "confirm",
  "app/projects/page.tsx:delete-project-title": "confirm",
  "app/projects/[projectId]/page.tsx:material-management-title": "view",
  "app/projects/[projectId]/page.tsx:material-preview-title": "view",
  "app/projects/[projectId]/page.tsx:create-material-set-title": "confirm",
  "app/projects/[projectId]/page.tsx:rename-material-set-title": "confirm",
  "app/projects/[projectId]/page.tsx:rename-material-title": "confirm",
  "app/projects/[projectId]/page.tsx:upload-material-title": "confirm",
  "app/projects/[projectId]/page.tsx:invite-project-member-title": "confirm",
  "app/projects/[projectId]/page.tsx:bind-channel-account-title": { variants: [
    { mode: "confirm", bindings: { choosingPlatform: true } },
    { mode: "authorize", bindings: { choosingPlatform: false, deviceAuthorization: false } },
    { mode: "confirm", bindings: { choosingPlatform: false, deviceAuthorization: true } },
  ] },
  "app/projects/[projectId]/page.tsx:remove-project-member-title": "confirm",
  "app/organizations/page.tsx:organization-dialog-title": "confirm",
  "app/organizations/[organizationId]/page.tsx:rename-organization-title": "confirm",
  "app/organizations/[organizationId]/page.tsx:invite-member-title": "confirm",
  "app/organizations/[organizationId]/page.tsx:remove-organization-member-title": "confirm",
  "app/market_insight/page.tsx:create-insight-title": "confirm",
  "app/market_insight/page.tsx:rename-overview-insight-title": "confirm",
  "app/market_insight/[insightId]/page.tsx:source-preview-title": "view",
  "app/case_library/page.tsx:create-case-title": "confirm",
  "app/case_library/page.tsx:role:dialog": { variants: [
    ...editingModes("isEditingContent", { canEditContent: true }).variants,
    { mode: "view", bindings: { isEditingContent: true, canEditContent: false } },
  ] },
  "app/publishing/page.tsx:create-publication-title": "confirm",
  "components/publishing/PublicationWorkDialog.tsx:ReferencePickerDialog": "confirm",
  "app/publishing/page.tsx:rename-publication-title": "confirm",
  "app/publishing/[planId]/page.tsx:publication-plan-heading": editingModes("settingsEditable"),
  "app/portfolio/page.tsx:rename-work-title": "confirm",
  "app/portfolio/page.tsx:create-work-title": "confirm",
  "components/auth/sliding_panel.tsx:role:dialog": "auth",
  "components/redesign/DeleteConfirmDialog.tsx:titleId": "confirm",
  "components/content_generator/ReferencePickerDialog.tsx:titleId": "composed",
  "components/content_generator/ReferencePanel.tsx:ReferencePickerDialog": "confirm",
  "components/content_generator/MaterialReferencePicker.tsx:ReferencePickerDialog": "confirm",
  "components/portfolio/PortfolioMaterialPicker.tsx:ReferencePickerDialog": "confirm",
  "components/content_generator/ContentGeneratorExperience.tsx:select-content-project-title": "confirm",
  "components/content_generator/ContentGeneratorExperience.tsx:rename-creation-title": "confirm",
  "components/publishing/PublicationSchedulePicker.tsx:menuId": { variants: [
    { mode: "view", bindings: { kind: "date", month: true } },
    { mode: "confirm", bindings: { kind: "time" } },
  ] },
  "components/projects/MaterialDocumentPreview.tsx:component": editingModes("editing"),
  "components/account_content/AccountContentPreview.tsx:titleId": "view",
};

function sourceFiles(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const filename = path.join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(filename)
      : /\.tsx?$/.test(filename) && !/\.test\.tsx?$/.test(filename) ? [filename] : [];
  });
}

function attributes(node: ts.JsxOpeningElement | ts.JsxSelfClosingElement) {
  return node.attributes.properties.filter(ts.isJsxAttribute);
}

function attribute(node: ts.JsxOpeningElement | ts.JsxSelfClosingElement, name: string) {
  return attributes(node).find((item) => item.name.getText() === name)?.initializer;
}

function value(node: ts.JsxOpeningElement | ts.JsxSelfClosingElement, name: string) {
  const initializer = attribute(node, name);
  if (initializer && ts.isStringLiteral(initializer)) return initializer.text;
  if (initializer && ts.isJsxExpression(initializer)) {
    const expression = initializer.expression;
    return expression && ts.isStringLiteral(expression) ? expression.text : expression?.getText();
  }
  return undefined;
}

function identity(node: ts.JsxOpeningElement) {
  return value(node, "aria-labelledby") || value(node, "id")
    || (node.tagName.getText() === "ReferencePickerDialog" ? "ReferencePickerDialog" : `role:${value(node, "role")}`);
}

function isDialog(node: ts.JsxElement) {
  const opening = node.openingElement;
  return ["dialog", "ReferencePickerDialog"].includes(opening.tagName.getText())
    || ["dialog", "alertdialog"].includes(value(opening, "role") || "");
}

function scalar(expression: ts.Expression, bindings: Bindings): boolean | string | undefined {
  if (ts.isParenthesizedExpression(expression)) return scalar(expression.expression, bindings);
  if (ts.isIdentifier(expression)) return bindings[expression.text];
  if (ts.isStringLiteral(expression)) return expression.text;
  if (expression.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (expression.kind === ts.SyntaxKind.FalseKeyword) return false;
  return undefined;
}

function truth(expression: ts.Expression, bindings: Bindings): boolean | undefined {
  if (ts.isParenthesizedExpression(expression)) return truth(expression.expression, bindings);
  const direct = scalar(expression, bindings);
  if (typeof direct === "boolean") return direct;
  if (ts.isPrefixUnaryExpression(expression) && expression.operator === ts.SyntaxKind.ExclamationToken) {
    const result = truth(expression.operand, bindings);
    return result === undefined ? undefined : !result;
  }
  if (ts.isBinaryExpression(expression)) {
    const operator = expression.operatorToken.kind;
    if (operator === ts.SyntaxKind.AmpersandAmpersandToken || operator === ts.SyntaxKind.BarBarToken) {
      const left = truth(expression.left, bindings);
      const right = truth(expression.right, bindings);
      if (operator === ts.SyntaxKind.AmpersandAmpersandToken) {
        return left === false || right === false ? false : left === true && right === true ? true : undefined;
      }
      return left === true || right === true ? true : left === false && right === false ? false : undefined;
    }
    if (operator === ts.SyntaxKind.EqualsEqualsEqualsToken || operator === ts.SyntaxKind.ExclamationEqualsEqualsToken) {
      const left = scalar(expression.left, bindings);
      const right = scalar(expression.right, bindings);
      if (left === undefined || right === undefined) return undefined;
      return operator === ts.SyntaxKind.EqualsEqualsEqualsToken ? left === right : left !== right;
    }
  }
  return undefined;
}

function actions(root: ts.Node, bindings: Bindings) {
  const result = { cancel: 0, confirm: 0, close: 0, back: 0 };
  const order: Array<"cancel" | "confirm" | "back"> = [];
  const visit = (node: ts.Node) => {
    if (ts.isConditionalExpression(node)) {
      const condition = truth(node.condition, bindings);
      if (condition !== false) visit(node.whenTrue);
      if (condition !== true) visit(node.whenFalse);
      return;
    }
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) {
      if (truth(node.left, bindings) !== false) visit(node.right);
      return;
    }
    if (ts.isJsxElement(node)) {
      if (node !== root && isDialog(node)) return;
      const opening = node.openingElement;
      if (["button", "GuardedButton", "RedesignButton"].includes(opening.tagName.getText())) {
        const text = node.children.map((child) => child.getText()).join("");
        const props = opening.attributes.getText();
        const label = value(opening, "aria-label") || value(opening, "title") || "";
        const isCancel = /(?:CHINESE_ACTIONS|ENGLISH_ACTIONS)\.cancel\b|\bcancelLabel\b|["'](?:取消|Cancel)["']/.test(text);
        const isBack = /(?:CHINESE_ACTIONS|ENGLISH_ACTIONS)\.back\b/.test(text);
        const launchesDialog = /\b(?:set\w*ToDelete|set\w*ToRename|open\w*Dialog)\s*\(/.test(value(opening, "onClick") || "");
        const isConfirm = !launchesDialog && (value(opening, "type") === "submit"
          || /(?:CHINESE_ACTIONS|ENGLISH_ACTIONS)\.(?:confirm|save|create|upload|import|add|delete|invite|bind|connect|signIn|signUp)\b|\bconfirmLabel\b|["'](?:确定|确认|Apply)["']/.test(text));
        const closeIcon = /name=["']close["']|>[\s]*[×✕❌][\s]*</.test(node.getText());
        const dismisses = /关闭|\bClose\b|(?:CHINESE_ACTIONS|ENGLISH_ACTIONS)\.close\b/.test(label)
          || /className=["'][^"']*(?:modal-close|preview-close)/.test(props);
        if (isCancel) {
          result.cancel++;
          order.push("cancel");
        }
        if (isBack) {
          result.back++;
          order.push("back");
        }
        if (isConfirm) result.confirm++;
        const primaryConfirmation = isConfirm && (value(opening, "type") === "submit"
          || /amp-button-primary|project-delete-confirm|is-primary/.test(value(opening, "className") || "")
          || /(?:CHINESE_ACTIONS|ENGLISH_ACTIONS)\.confirm\b|\bconfirmLabel\b/.test(text));
        if (primaryConfirmation) order.push("confirm");
        if (closeIcon && dismisses) {
          assert.ok(attribute(opening, "aria-label") || attribute(opening, "title"), "Close icons need an accessible name");
          result.close++;
        }
        return;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(root);
  return { ...result, order };
}

test("every dialog follows its audited confirmation or preview action pattern", () => {
  const seen = new Set<string>();
  const failures: string[] = [];
  const verify = (key: string, root: ts.Node) => {
    seen.add(key);
    const mode = dialogModes[key];
    if (!mode) { failures.push(`${key}: classify the new dialog`); return; }
    const check = (expected: ActionMode, bindings: Bindings) => {
      const found = actions(root, bindings);
      if (expected === "confirm" && (found.cancel === 0 || found.close > 0)) {
        failures.push(`${key}: confirmation requires Cancel and no close X (${JSON.stringify(found)})`);
      }
      if (expected === "confirm" && found.order.includes("confirm") && found.order[0] !== "cancel") {
        failures.push(`${key}: Cancel must precede the primary confirmation (${found.order.join(", ")})`);
      }
      if (expected === "view" && (found.close === 0 || found.cancel > 0 || found.confirm > 0)) {
        failures.push(`${key}: preview requires close X without Confirm/Cancel (${JSON.stringify(found)})`);
      }
      if (expected === "composed" && (found.close > 0 || found.cancel > 0 || found.confirm > 0)) {
        failures.push(`${key}: shared shell must leave actions to the caller`);
      }
      if (expected === "authorize" && (found.back !== 1 || found.confirm !== 1 || found.cancel > 0
        || found.close > 0 || found.order.join(",") !== "back,confirm")) {
        failures.push(`${key}: authorization introduction uses Back then Connect without Cancel/X (${JSON.stringify(found)})`);
      }
      if (expected === "auth" && (found.close !== 1 || found.cancel > 0 || found.confirm === 0)) {
        failures.push(`${key}: authentication uses one close X, submit actions, and no Cancel (${JSON.stringify(found)})`);
      }
    };
    if (typeof mode === "string") check(mode, {});
    else mode.variants.forEach((variant) => check(variant.mode, variant.bindings));
  };
  for (const filename of sourceFiles(sourceRoot)) {
    const relative = path.relative(sourceRoot, filename).split(path.sep).join("/");
    const source = ts.createSourceFile(filename, fs.readFileSync(filename, "utf8"), ts.ScriptTarget.Latest, true,
      filename.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const visit = (node: ts.Node) => {
      if (ts.isJsxElement(node) && isDialog(node)) verify(`${relative}:${identity(node.openingElement)}`, node);
      ts.forEachChild(node, visit);
    };
    visit(source);
    if (relative === "components/projects/MaterialDocumentPreview.tsx") verify(`${relative}:component`, source);
  }
  const missing = Object.keys(dialogModes).filter((key) => !seen.has(key));
  assert.deepEqual(missing, [], `Update the inventory when removing a dialog:\n${missing.join("\n")}`);
  assert.deepEqual(failures, [], failures.join("\n"));
});

test("modal overlays are named dialogs and do not bypass the policy with browser alerts", () => {
  const violations: string[] = [];
  for (const filename of sourceFiles(sourceRoot)) {
    const source = ts.createSourceFile(filename, fs.readFileSync(filename, "utf8"), ts.ScriptTarget.Latest, true,
      filename.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const report = (node: ts.Node, message: string) => {
      const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
      violations.push(`${path.relative(sourceRoot, filename)}:${line}: ${message}`);
    };
    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node) && /^(?:(?:window|globalThis)\.)?(?:alert|confirm|prompt)$/.test(node.expression.getText(source))) {
        report(node, "Use an audited application dialog instead of a browser dialog");
      }
      if (ts.isJsxElement(node)) {
        const tokens = new Set((value(node.openingElement, "className") || "").split(/\s+/));
        if (["fixed", "inset-0", "items-center", "justify-center"].every((token) => tokens.has(token))) {
          let parent: ts.Node | undefined = node;
          let namedDialog = false;
          while (parent) {
            if (ts.isJsxElement(parent) && isDialog(parent)) {
              const opening = parent.openingElement;
              namedDialog = Boolean(attribute(opening, "aria-labelledby") || attribute(opening, "aria-label"));
              break;
            }
            parent = parent.parent;
          }
          if (!namedDialog) report(node, "Give modal overlays a dialog role and an accessible name");
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  assert.deepEqual(violations, [], violations.join("\n"));
});
