import assert from "node:assert/strict";
import test from "node:test";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { I18nProvider } from "../../contexts/i18n_context.tsx";
import { ToastProvider } from "../../contexts/toast_context.tsx";
import {
  GuardedButton, GuardedInput, GuardedSelect, GuardedTextarea, preventBlockedInteraction,
} from "./GuardedControls.tsx";

function renderControl(child: ReactNode) {
  return renderToStaticMarkup(createElement(I18nProvider, null,
    createElement(ToastProvider, null, child),
  ));
}

test("blocked buttons stay focusable and retain accessible disabled semantics", () => {
  const html = renderControl(createElement(GuardedButton, {
    type: "submit", disabled: true, blockedReason: "Choose a project", className: "amp-button",
  }, "Create"));
  assert.match(html, /type="submit"/);
  assert.match(html, /aria-disabled="true"/);
  assert.match(html, /data-blocked-action="true"/);
  assert.doesNotMatch(html, /(?:^|\s)disabled=/);
  assert.doesNotMatch(html, /tabindex="-1"/i);
  assert.doesNotMatch(html, /blockedReason=/);
});

test("available buttons keep native action semantics without blocked markers", () => {
  const html = renderControl(createElement(GuardedButton, {
    type: "button", disabled: false, blockedReason: "Unavailable",
  }, "Continue"));
  assert.match(html, /type="button"/);
  assert.doesNotMatch(html, /aria-disabled|data-blocked-action/);
});

test("blocked text fields protect their values without losing focus or readability", () => {
  for (const control of [
    createElement(GuardedInput, { disabled: true, blockedReason: "Saving", value: "Preserved" }),
    createElement(GuardedTextarea, { disabled: true, blockedReason: "Saving", value: "Preserved" }),
  ]) {
    const html = renderControl(control);
    assert.match(html, /readonly/i);
    assert.match(html, /Preserved/);
    assert.match(html, /aria-disabled="true"/);
    assert.doesNotMatch(html, /(?:^|\s)disabled=/);
  }
});

test("blocked native selects retain their current option without native disabling", () => {
  const html = renderControl(createElement(GuardedSelect, {
    disabled: true, blockedReason: "Selection locked", value: "existing", onChange: () => {},
  }, createElement("option", { value: "existing" }, "Existing")));
  assert.match(html, /aria-disabled="true"/);
  assert.match(html, /selected/);
  assert.doesNotMatch(html, /(?:^|\s)disabled=/);
});

test("blocking cancels default actions and propagation and reports the exact reason", () => {
  let defaults = 0;
  let propagation = 0;
  const messages: string[] = [];
  preventBlockedInteraction({
    preventDefault: () => { defaults++; },
    stopPropagation: () => { propagation++; },
  }, "Choose a project first", (message) => messages.push(message));
  assert.equal(defaults, 1);
  assert.equal(propagation, 1);
  assert.deepEqual(messages, ["Choose a project first"]);
});
