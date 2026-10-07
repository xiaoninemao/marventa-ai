import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { I18nProvider } from "../../contexts/i18n_context.tsx";
import { ToastProvider } from "../../contexts/toast_context.tsx";
import type { SessionRecord } from "../../types/content_generator.ts";
import ContentGeneratorCardWorkspace from "./ContentGeneratorCardWorkspace.tsx";

const session: SessionRecord = {
  id: "session",
  user_id: "owner",
  project_id: "project",
  title: "Launch",
  messages: [],
  cards: [{
    id: "copy",
    card_type: "copy",
    title: "Post copy",
    preview: "Preview",
    content: "Body",
    tips: [],
  }],
  status: "completed",
  insight_ids: [],
  case_ids: [],
  created_at: "2026-10-07 00:00:00",
  updated_at: "2026-10-07 00:00:00",
};

test("creative workspace exposes actionable blocking quality findings", () => {
  const html = renderToStaticMarkup(createElement(
    I18nProvider,
    null,
    createElement(ToastProvider, null, createElement(ContentGeneratorCardWorkspace, {
      session,
      locale: "en",
      disabled: false,
      blockedReason: "",
      generating_document: false,
      checking_quality: false,
      quality_report: {
        ready: false,
        summary: "Resolve the configured brand restriction.",
        issues: [{
          category: "brand",
          severity: "blocking",
          card_id: "copy",
          evidence: "Configured prohibited term: guaranteed",
          suggestion: "Remove or replace this prohibited term.",
        }],
        checked_at: "2026-10-07T00:00:00+00:00",
      },
      active_card_index: 0,
      flipped_ids: new Set<string>(),
      on_active_card_change: () => {},
      on_generate_document: () => {},
      on_quality_check: () => {},
      render_card: () => createElement("div", null, "Card"),
      render_detail: () => createElement("div", null, "Detail"),
    })),
  ));
  assert.match(html, />Quality check</);
  assert.match(html, /Action required/);
  assert.match(html, /data-severity="blocking"/);
  assert.match(html, /Configured prohibited term: guaranteed/);
  assert.match(html, /Remove or replace this prohibited term/);
});
