import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { I18nProvider } from "../../contexts/i18n_context.tsx";
import OpinionProjectCard from "./OpinionProjectCard.tsx";
import type { ContentProject } from "../../types/publishing.ts";

const project: ContentProject = {
  id: "project/a", title: "<Campaign>", user_id: "", xhs_account: "", source_session_id: "",
  content_type: "", platform_hint: "", final_snapshot: {}, notes: "Project description",
  status: "", role: "owner", avatar_color: "#bfdbfe", avatar_icon: "📷",
  brand_profile: { tone: "", audience: "", value_proposition: "", visual_style: "", prohibited_terms: [] },
  members: [{ user_id: "user", username: "Alice", email: "", nickname: "", avatar_url: "", role: "owner", joined_at: "" }],
  member_count: 1, created_at: "", updated_at: "",
};

function render(data = project, accountCount = 2) {
  return renderToStaticMarkup(createElement(I18nProvider, null,
    createElement(OpinionProjectCard, { project: data, accountCount })));
}

test("opinion projects use the existing project card hierarchy and real project identity", () => {
  const html = render();
  for (const name of ["amp-project-card", "amp-project-card-open", "amp-project-avatar",
    "amp-project-card-copy", "amp-project-card-description", "amp-project-card-members", "amp-project-card-meta"]) {
    assert.ok(html.includes(name));
  }
  assert.match(html, /href="\/opinion_tracking\?project=project%2Fa"/);
  assert.match(html, /&lt;Campaign&gt;/);
  assert.match(html, /Project description/);
  assert.match(html, /📷/);
  assert.match(html, /1 project members/);
  assert.match(html, /2 accounts/);
  assert.match(html, /title="Alice"/);
  assert.doesNotMatch(html, /amp-insight-card|amp-opinion-project-card/);
});

test("empty descriptions and additional members preserve project card presentation", () => {
  const html = render({ ...project, notes: "", avatar_icon: "", member_count: 8 }, 0);
  assert.match(html, /No project description/);
  assert.match(html, /💡/);
  assert.match(html, /0 accounts/);
  assert.match(html, /amp-project-card-member-more/);
  assert.doesNotMatch(html, /undefined|NaN/);
});

test("opinion project grids reuse project columns, spacing and collapse behavior", () => {
  const source = readFileSync(new URL("../../app/opinion_tracking/page.tsx", import.meta.url), "utf8");
  assert.match(source, /className="amp-projects-grid amp-opinion-project-grid"/);
  assert.match(source, /<OpinionProjectCard key=\{item\.id\} project=\{item\}/);
  const css = readFileSync(new URL("../../styles/projects.css", import.meta.url), "utf8");
  assert.match(css, /\.amp-opinion-project-grid \{ margin-top: 24px; \}/);
  assert.doesNotMatch(css, /\.amp-opinion-project-card/);
});
