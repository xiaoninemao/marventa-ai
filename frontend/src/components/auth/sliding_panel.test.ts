import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AuthProvider } from "../../contexts/auth_context.tsx";
import { I18nProvider } from "../../contexts/i18n_context.tsx";
import { ToastProvider } from "../../contexts/toast_context.tsx";
import SlidingPanel from "./sliding_panel.tsx";

for (const mode of ["login", "register"] as const) {
  test(`${mode} panel uses a close icon and one full-width submit action`, () => {
    const html = renderToStaticMarkup(createElement(AuthProvider, null,
      createElement(I18nProvider, null, createElement(ToastProvider, null,
        createElement(SlidingPanel, { open: true, mode, onClose: () => {}, onSwitch: () => {} }),
      )),
    ));
    assert.match(html, /role="dialog"/);
    assert.doesNotMatch(html, /amp-login-actions|amp-button-cancel|>Cancel<\/span>/);
    assert.match(html, /type="submit"[^>]+amp-login-submit/);
    assert.match(html, /class="amp-modal-close"[^>]+aria-label="Close"/);
    assert.match(html, /<svg[^>]+h-5 w-5/);
  });
}
