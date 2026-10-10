import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { I18nProvider } from "../../contexts/i18n_context.tsx";
import AgentConversation, { AgentText } from "./AgentConversation.tsx";

test("assistant paragraphs justify full lines while leaving the final line naturally aligned", () => {
  const css = readFileSync(new URL("../../styles/projects.css", import.meta.url), "utf8");
  const paragraph = css.match(/\.amp-redesign \.amp-agent-conversation-text p\s*\{([^}]+)\}/)?.[1];
  assert.ok(paragraph);
  assert.match(paragraph, /text-align:\s*justify;/);
  assert.match(paragraph, /text-align-last:\s*start;/);
});

test("working conversation interleaves real commentary and concrete tools without an Agent flowchart", () => {
  const html = renderToStaticMarkup(createElement(I18nProvider, null, createElement(AgentConversation, {
    running: true,
    events: [
      { type: "status", stage: "routing_agent" },
      { type: "message", id: "first", content: "I will check the selected materials." },
      { type: "tool", id: "tool", tool: "import_material", status: "completed", details: ["Campaign logo"] },
      { type: "message", id: "final", content: "The work is ready." },
    ],
    finalReply: "The work is ready.",
  })));
  assert.ok(html.indexOf("I will check") < html.indexOf("Campaign logo"));
  assert.ok(html.indexOf("Campaign logo") < html.indexOf("The work is ready."));
  assert.equal((html.match(/The work is ready\./g) || []).length, 1);
  assert.doesNotMatch(html, /Router|Plan Agent|amp-content-agent-step/);
});

test("assistant text renders readable structure without executing HTML or unsafe links", () => {
  const html = renderToStaticMarkup(createElement(AgentText, {
    content: "## Findings\n\n- **First** item\n- `Second` item\n\n<script>alert(1)</script>\n\n[Unsafe](javascript:alert)",
  }));
  assert.match(html, /<h4>Findings<\/h4>/);
  assert.match(html, /<ul>/);
  assert.match(html, /<strong>First<\/strong>/);
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /<script>|href="javascript:/);
});
