import assert from "node:assert/strict";
import test from "node:test";
import { canEditInsightResults, canManageInsight, isInsightAnalyzed } from "./insight_permissions.ts";
import type { User } from "../types/auth.ts";

const organization = {
  id: "org-a", name: "Team", avatar_url: "", role: "member" as const,
  is_default: true, uses_default_name: false,
};
const user: User = {
  id: "viewer", username: "viewer", email: "", nickname: "", avatar_url: "",
  current_organization: organization, default_organization: organization,
};
const insight = {
  owner_id: "creator",
  organization_id: "org-a",
  project_role: "member" as const,
};

test("only the creator and project managers can manage an insight", () => {
  assert.equal(canManageInsight(null, insight), false);
  assert.equal(canManageInsight(user, insight), false);
  assert.equal(canManageInsight(user, { ...insight, owner_id: user.id }), true);
  assert.equal(canManageInsight(user, { ...insight, project_role: "owner" }), true);
  assert.equal(canManageInsight(user, { ...insight, project_role: "admin" }), true);
});

test("organization roles do not grant insight management", () => {
  assert.equal(canManageInsight({
    ...user,
    current_organization: { ...organization, role: "admin" },
  }, insight), false);
});

test("permissions do not survive an organization switch", () => {
  const switched = {
    ...user,
    current_organization: { ...organization, id: "org-b" },
  };
  assert.equal(canManageInsight(switched, { ...insight, owner_id: user.id }), false);
  assert.equal(canManageInsight(switched, { ...insight, project_role: "admin" }), false);
});

test("only completed insights with analysis can be referenced", () => {
  assert.equal(isInsightAnalyzed({ status: "analyzing", ai_analysis: null }), false);
  assert.equal(isInsightAnalyzed({ status: "completed", ai_analysis: null }), false);
  assert.equal(isInsightAnalyzed({
    status: "completed",
    ai_analysis: {
      product_name: "Product",
      product_category: "",
      product_description: "",
      product_images: [],
      similar_products: [],
      strengths: [],
      weaknesses: [],
      product_summary: "",
      target_audience: "",
      use_cases: [],
      market_positioning: "",
      tech_highlights: [],
      suggested_marketing_angles: [],
      marketing_stage: "",
    },
  }), true);
});

test("AI-generated insight results do not expose manual editing to any project role", () => {
  for (const source_type of ["markdown", "pdf", "docx", "repo"]) {
    assert.equal(canEditInsightResults(user, {
      ...insight, owner_id: user.id, source_type,
    }), false);
    for (const project_role of ["owner", "admin", "member"] as const) {
      assert.equal(canEditInsightResults(user, { ...insight, project_role, source_type }), false);
    }
  }
});

test("manual insight editing retains creator and project-manager permissions", () => {
  const manual = { ...insight, source_type: "manual" };
  assert.equal(canEditInsightResults(user, manual), false);
  assert.equal(canEditInsightResults(user, { ...manual, owner_id: user.id }), true);
  assert.equal(canEditInsightResults(user, { ...manual, project_role: "owner" }), true);
  assert.equal(canEditInsightResults(user, { ...manual, project_role: "admin" }), true);
  assert.equal(canEditInsightResults(null, { ...manual, owner_id: user.id }), false);
  assert.equal(canEditInsightResults({
    ...user, current_organization: { ...organization, id: "org-b" },
  }, { ...manual, owner_id: user.id }), false);
});
