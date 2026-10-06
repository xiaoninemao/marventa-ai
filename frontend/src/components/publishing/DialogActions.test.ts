import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

type Element = ts.JsxElement | ts.JsxSelfClosingElement;

function source(path: string) {
  return ts.createSourceFile(path, readFileSync(new URL(path, import.meta.url), "utf8"),
    ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
}

function elements(node: ts.Node): Element[] {
  const result: Element[] = [];
  function visit(child: ts.Node) {
    if (ts.isJsxElement(child) || ts.isJsxSelfClosingElement(child)) result.push(child);
    ts.forEachChild(child, visit);
  }
  visit(node);
  return result;
}

function opening(node: Element) {
  return ts.isJsxElement(node) ? node.openingElement : node;
}

function attribute(node: Element, name: string) {
  const attr = opening(node).attributes.properties.find(
    (prop): prop is ts.JsxAttribute => ts.isJsxAttribute(prop) && prop.name.getText() === name,
  );
  return attr?.initializer?.getText() ?? "";
}

function find(node: ts.Node, tag: string, attr: string, value: string) {
  const found = elements(node).find((element) =>
    opening(element).tagName.getText() === tag && attribute(element, attr) === value);
  assert.ok(found, `${tag} ${attr}=${value}`);
  return found;
}

function cancel(node: ts.Node) {
  const found = elements(node).find((element) =>
    attribute(element, "className") === '"amp-button amp-button-secondary amp-button-cancel"');
  assert.ok(found, "standardized textual Cancel");
  assert.equal(opening(found).tagName.getText(), "GuardedButton");
  assert.equal(attribute(found, "type"), '"button"');
  assert.match(found.getText(), /t\(CHINESE_ACTIONS\.cancel, ENGLISH_ACTIONS\.cancel\)/);
  return found;
}

function close(node: ts.Node) {
  const icon = find(node, "InlineIcon", "name", '"close"');
  const button = icon.parent;
  assert.ok(ts.isJsxElement(button));
  assert.ok(attribute(button, "aria-label"), "close X must have an accessible name");
  return button;
}

test("material selection has guarded Cancel and Add/Import without a dismissal X", () => {
  const file = source("./PublicationContentPanel.tsx");
  const picker = find(file, "dialog", "ref", "{picker}");
  const button = cancel(picker);
  assert.equal(attribute(button, "disabled"), "{busy}");
  assert.equal(attribute(button, "blockedReason"), "{busyReason}");
  assert.equal(attribute(button, "onClick"), "{() => picker.current?.close()}");
  assert.equal(attribute(picker, "onClose"), "{() => setPickerOpen(false)}");
  assert.match(attribute(picker, "onCancel"), /if \(busy\).*event\.preventDefault\(\)/);
  assert.ok(!elements(picker).some((node) => attribute(node, "name") === '"close"'));
  assert.match(picker.getText(), /onClick=\{\(\) => void addSelected\(\)\}/);
  assert.match(picker.getText(), /disabled=\{locked \|\| !selected\.size\}/);
  assert.match(picker.getText(), /CHINESE_ACTIONS\.import/);
  assert.match(picker.getText(), /CHINESE_ACTIONS\.add/);
});

test("media and PDF previews use accessible close X without Cancel or Confirm", () => {
  const media = find(source("./PublicationContentPanel.tsx"), "dialog", "ref", "{preview}");
  const pdf = find(source("../../app/portfolio/[scriptId]/page.tsx"), "dialog", "ref", "{pdfPreviewDialogRef}");
  for (const dialog of [media, pdf]) {
    close(dialog);
    assert.doesNotMatch(dialog.getText(), /CHINESE_ACTIONS\.(?:cancel|confirm)/);
  }
  const pdfClose = close(pdf);
  assert.equal(attribute(pdfClose, "disabled"), "{exportingPdf}");
  assert.equal(attribute(pdfClose, "blockedReason"), "{exportReason}");
  assert.match(attribute(pdf, "onCancel"), /if \(!exportingPdf\)/);
  assert.match(pdf.getText(), /onClick=\{\(\) => void exportPdf\(\)\}/);
  assert.match(pdf.getText(), /CHINESE_ACTIONS\.export/);
});

test("settings switches dismissal controls when explicit Save is available", () => {
  const dialog = find(source("../../app/publishing/[planId]/page.tsx"), "dialog", "ref", "{settingsDialog}");
  const cancelButton = cancel(dialog);
  const closeButton = close(dialog);
  assert.match(cancelButton.parent.getText(), /^settingsEditable && /);
  assert.match(closeButton.parent.getText(), /^!settingsEditable && /);
  assert.equal(attribute(cancelButton, "disabled"), "{saving}");
  assert.match(attribute(dialog, "onCancel"), /if \(saving\).*event\.preventDefault\(\)/);
  assert.match(dialog.getText(), /\{settingsEditable && <GuardedButton[^>]*type="submit"/);
  assert.match(dialog.getText(), /onSubmit=\{\(event\) => void save\(event\)\}/);
  assert.match(dialog.getText(), /t\("取消定时发布", "Cancel scheduled publication"\)/);
  const confirmation = find(source("../../app/publishing/[planId]/page.tsx"), "DeleteConfirmDialog", "open", "{confirmCancel}");
  assert.equal(attribute(confirmation, "cancelLabel"), "{t(CHINESE_ACTIONS.cancel, ENGLISH_ACTIONS.cancel)}");
  assert.match(attribute(confirmation, "onCancel"), /settingsDialog\.current\?\.showModal\(\)/);
});

test("published visibility guidance belongs to settings rather than the content workspace", () => {
  const file = source("../../app/publishing/[planId]/page.tsx");
  const dialog = find(file, "dialog", "ref", "{settingsDialog}");
  const notices = elements(file).filter((node) =>
    opening(node).tagName.getText() === "p" && /t\(publishedNotice\.zh, publishedNotice\.en\)/.test(node.getText()));
  assert.equal(notices.length, 1);
  assert.ok(elements(dialog).includes(notices[0]));
  assert.equal(attribute(notices[0], "role"), '"status"');
  assert.equal(attribute(notices[0], "className"), '"amp-publication-settings-notice"');
  const list = source("../../app/publishing/page.tsx");
  assert.doesNotMatch(list.getText(), /publicationPublishedNotice|publishedNotice/);
  assert.match(list.getText(), /\{plan\.outcome_unknown && <strong/);
});

test("publication cards use fluid tracks rather than leaving fixed-width grid space empty", () => {
  const css = readFileSync(new URL("../../styles/projects.css", import.meta.url), "utf8");
  const grid = css.match(/\.amp-redesign \.amp-publication-brief-grid \{([^}]+)\}/)?.[1];
  assert.ok(grid);
  assert.match(grid, /repeat\(auto-fill, minmax\(min\(100%, 260px\), 1fr\)\)/);
  assert.doesNotMatch(grid, /minmax\(0, 280px\)/);
});

test("time selection cancels without committing and reopens from the stored value", () => {
  const file = source("./PublicationSchedulePicker.tsx");
  const dialog = find(file, "div", "role", '"dialog"');
  const cancelButton = cancel(dialog);
  assert.equal(attribute(cancelButton, "onClick"), "{closeMenu}");
  assert.equal(attribute(cancelButton, "disabled"), "{disabled}");
  assert.equal(attribute(cancelButton, "blockedReason"), "{blockedReason}");
  assert.doesNotMatch(cancelButton.getText(), /onChange|setDraftTime/);
  assert.match(dialog.getText(), /onChange\(draftTime\);\s+closeMenu\(\);/);
  assert.match(file.getText(), /setDraftTime\(kind === "time" && value \? value : "09:00"\)/);
  const closeButton = close(dialog);
  assert.equal(attribute(closeButton, "onClick"), "{closeMenu}");
  assert.equal(attribute(closeButton, "aria-label"), '{t("关闭日历", "Close calendar")}');
  assert.ok(ts.isJsxElement(closeButton.parent));
  assert.equal(attribute(closeButton.parent, "className"), '"amp-schedule-calendar-heading"');
  const branch = closeButton.parent.parent.parent;
  assert.ok(ts.isConditionalExpression(branch));
  assert.equal(branch.condition.getText(), 'kind === "date" && month');
  assert.doesNotMatch(branch.whenTrue.getText(), /CHINESE_ACTIONS\.(?:cancel|confirm)/);
  assert.doesNotMatch(branch.whenFalse.getText(), /name="close"/);
});

test("case details exposes close X only outside the guarded Save/Cancel editor", () => {
  const file = source("../../app/case_library/page.tsx");
  const dialog = find(file, "div", "role", '"dialog"');
  const closeButton = close(dialog);
  assert.match(closeButton.parent.getText(), /^!\(isEditingContent && canEditContent\) && /);
  const cancelButton = cancel(dialog);
  assert.equal(attribute(cancelButton, "onClick"), "{cancelContentEdit}");
  assert.equal(attribute(cancelButton, "disabled"), "{isSavingContent}");
  assert.match(file.getText(), /const cancelContentEdit = \(\) => \{\s+setDraftTitle\(item\.title\);/);
  assert.match(dialog.getText(), /disabled=\{isSavingContent \|\| !draftTitle\.trim\(\)\} onClick=\{saveContent\}/);
});

test("existing create/upload/import and rename confirmations retain guarded Cancel", () => {
  const dialogs = [
    [source("../../app/publishing/page.tsx"), "{dialogRef}", "{saving}"],
    [source("../../app/publishing/page.tsx"), "{renameDialogRef}", "{saving}"],
    [source("../../app/case_library/page.tsx"), "{createDialogRef}", "{isImporting}"],
    [source("../../app/portfolio/page.tsx"), "{renameDialogRef}", "{renaming}"],
  ] as const;
  for (const [file, ref, busy] of dialogs) {
    const dialog = find(file, "dialog", "ref", ref);
    const button = cancel(dialog);
    assert.equal(attribute(button, "disabled"), busy);
    assert.match(attribute(dialog, "onCancel"), /event\.preventDefault\(\)/);
    const dismissalButtons = elements(dialog).filter((node) =>
      ["button", "GuardedButton"].includes(opening(node).tagName.getText())
      && attribute(node, "onClick").includes("?.close()"));
    assert.equal(dismissalButtons.length, 1, "only textual Cancel dismisses the dialog");
    assert.equal(dismissalButtons[0], button);
  }
});

test("account selection reports a missing channel before unsupported-channel or missing-account feedback", () => {
  const dialog = find(source("../../app/publishing/[planId]/page.tsx"), "dialog", "ref", "{settingsDialog}");
  const account = find(dialog, "EnterpriseSelect", "ariaLabel", '{t("选择发布账号", "Select publication account")}');
  const reason = attribute(account, "disabledReason");
  assert.match(reason, /!settingsEditable \|\| saving \|\| contentBusy \|\| cancelling \? settingsReason/);
  assert.match(reason, /: !form\.platform \? selectChannelReason/);
  assert.match(reason, /: form\.platform !== "douyin" \? unsupportedReason/);
  assert.ok(reason.indexOf("!form.platform") < reason.indexOf('form.platform !== "douyin"'));
  assert.match(reason, /: noAccountReason/);
});

test("save button and form submission share validation instead of separate platform checks", () => {
  const file = source("../../app/publishing/[planId]/page.tsx");
  const dialog = find(file, "dialog", "ref", "{settingsDialog}");
  const save = find(dialog, "GuardedButton", "blockedReason", "{saveReason}");
  assert.equal(attribute(save, "disabled"), "{Boolean(saveReason)}");
  assert.match(file.getText(), /const validationReason = settingsValidationReason\(plan, form\)/);
  assert.match(file.getText(), /if \(validationReason\) \{ showError\(validationReason\); return; \}/);
  assert.match(file.getText(), /const saveReason = saving \|\| contentBusy \|\| cancelling \|\| !settingsEditable \? settingsReason\s+: settingsValidationReason\(plan, form\)/);
  assert.match(file.getText(), /"missing-channel": selectChannelReason/);
  assert.match(file.getText(), /"unsupported-channel": unsupportedReason/);
  assert.match(file.getText(), /"no-accounts": noAccountReason/);
});

test("publication media menu follows its caption width instead of reserving 180 pixels", () => {
  const css = readFileSync(new URL("../../styles/projects.css", import.meta.url), "utf8");
  const menu = css.match(/\.amp-redesign\.amp-publication-add-menu\s*\{([^}]*)\}/)?.[1];
  assert.ok(menu);
  assert.match(menu, /min-width:\s*0\s*;/);
  assert.match(menu, /width:\s*max-content\s*;/);
  assert.doesNotMatch(menu, /(?:min-)?width:\s*180px/);
});

test("scheduled plans have no Edit escape hatch while cancellation remains available to managers", () => {
  const file = source("../../app/publishing/[planId]/page.tsx");
  assert.match(file.getText(), /const settingsEditable = editable/);
  assert.doesNotMatch(file.getText(), /editingPlanId|setEditingPlanId/);
  assert.match(file.getText(), /!canManage \|\| !publicationHasScheduledRelease/);
  assert.match(file.getText(), /canManage && publicationHasScheduledRelease/);
  assert.match(file.getText(), /is-publication-readonly/);
  assert.match(file.getText(), /Scheduled content and settings are locked/);
  const styles = readFileSync(new URL("../../styles/projects.css", import.meta.url), "utf8");
  assert.match(styles, /\.is-publication-readonly \[data-blocked-action="true"\]/);
  assert.match(styles, /background: #f2f4f7/);
});
