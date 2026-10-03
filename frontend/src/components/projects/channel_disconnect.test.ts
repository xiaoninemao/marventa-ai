import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { I18nProvider } from "../../contexts/i18n_context.tsx";
import { ToastProvider } from "../../contexts/toast_context.tsx";
import DeleteConfirmDialog from "../redesign/DeleteConfirmDialog.tsx";

const source = ts.createSourceFile("page.tsx",
  readFileSync(new URL("../../app/projects/[projectId]/page.tsx", import.meta.url), "utf8"),
  ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const nodes: ts.Node[] = [];
function visit(node: ts.Node) {
  nodes.push(node);
  ts.forEachChild(node, visit);
}
visit(source);

function attribute(node: ts.JsxElement | ts.JsxSelfClosingElement, name: string) {
  const opening = ts.isJsxElement(node) ? node.openingElement : node;
  return opening.attributes.properties.find(
    (prop): prop is ts.JsxAttribute => ts.isJsxAttribute(prop) && prop.name.getText() === name,
  )?.initializer?.getText() || "";
}

test("disconnect menu only opens confirmation and does not revoke the account", () => {
  const menu = nodes.filter(ts.isJsxElement).find((node) =>
    attribute(node, "role") === '"menuitem"' && node.getText().includes("CHINESE_ACTIONS.disconnect"));
  assert.ok(menu);
  const handler = attribute(menu, "onClick");
  assert.match(handler, /setChannelMenuAccountId\(null\)/);
  assert.match(handler, /setAccountToDisconnect\(account\)/);
  assert.doesNotMatch(handler, /unbindChannelAccount|delete_project_channel_account/);
});

test("confirmation and cancellation use the selected account and busy protection", () => {
  const dialog = nodes.filter(ts.isJsxSelfClosingElement).find((node) =>
    node.tagName.getText() === "DeleteConfirmDialog"
    && attribute(node, "open") === "{Boolean(accountToDisconnect)}");
  assert.ok(dialog);
  assert.equal(attribute(dialog, "busy"), "{accountSaving}");
  assert.match(attribute(dialog, "message"), /accountToDisconnect\?\.account_name/);
  assert.equal(attribute(dialog, "onCancel"), "{() => setAccountToDisconnect(null)}");
  assert.match(attribute(dialog, "onConfirm"), /if \(accountToDisconnect\) void unbindChannelAccount\(accountToDisconnect\)/);
  assert.match(attribute(dialog, "blockedReason"), /Disconnection is in progress/);
  assert.match(attribute(dialog, "confirmLabel"), /CHINESE_ACTIONS\.disconnect/);
  assert.match(attribute(dialog, "cancelLabel"), /CHINESE_ACTIONS\.cancel/);
});

test("revocation rechecks scope and permission, clears selection only on success and retains errors", () => {
  const declaration = nodes.filter(ts.isVariableDeclaration).find((node) =>
    node.name.getText() === "unbindChannelAccount");
  assert.ok(declaration?.initializer && ts.isArrowFunction(declaration.initializer));
  const handler = declaration.initializer;
  assert.ok(ts.isBlock(handler.body));
  assert.match(handler.getText(), /if \(accountSaving\)/);
  assert.match(handler.getText(), /account\.project_id !== projectId \|\| project\.id !== projectId/);
  assert.match(handler.getText(), /!canManageMembers && account\.created_by_user_id !== user\?\.id/);
  const mutation = handler.body.statements.find(ts.isTryStatement);
  assert.ok(mutation?.catchClause);
  assert.match(mutation.tryBlock.getText(), /await delete_project_channel_account\(project\.id, account\.id\)/);
  assert.match(mutation.tryBlock.getText(), /setChannelAccounts/);
  assert.match(mutation.tryBlock.getText(), /setAccountToDisconnect\(null\)/);
  assert.match(mutation.catchClause.block.getText(), /showError/);
  assert.doesNotMatch(mutation.catchClause.block.getText(), /setAccountToDisconnect|setChannelAccounts/);
});

for (const busy of [false, true]) {
  test(`disconnect confirmation keeps Cancel on the left and guards both actions when busy=${busy}`, () => {
    const html = renderToStaticMarkup(createElement(I18nProvider, null,
      createElement(ToastProvider, null, createElement(DeleteConfirmDialog, {
        open: false, busy, title: "Disconnect account", message: "Disconnect this account?",
        cancelLabel: "Cancel", confirmLabel: "Disconnect", busyLabel: "Disconnecting...",
        blockedReason: "Disconnection is in progress", onCancel: () => {}, onConfirm: () => {},
      })),
    ));
    assert.match(html, busy ? /Cancel<\/button>[\s\S]*Disconnecting\.\.\.<\/button>/ : /Cancel<\/button>[\s\S]*Disconnect<\/button>/);
    assert.doesNotMatch(html, /aria-label="Close|amp-modal-close/);
    assert.equal((html.match(/aria-disabled="true"/g) || []).length, busy ? 2 : 0);
  });
}
