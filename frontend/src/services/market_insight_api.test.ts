import assert from "node:assert/strict";
import test from "node:test";
import { fetch_history_item, parse_files, parse_repo, retry_history_item, update_history_item } from "./market_insight_api.ts";
import type { AIAnalysis, HistoryRecord } from "../types/market_insight.ts";

test("insight upload, repository import and retry transmit the selected interface language", async (context) => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  context.mock.method(globalThis, "fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    requests.push({ url: String(input), init });
    return Response.json({ success: true, data: null });
  });

  for (const locale of ["zh-CN", "en"] as const) {
    const start = requests.length;
    await parse_files([new File(["# English source"], "source.md", { type: "text/markdown" })], "project", locale);
    const upload = requests[start].init?.body;
    assert.ok(upload instanceof FormData);
    assert.equal(upload.get("locale"), locale);
    assert.equal(upload.get("project_id"), "project");

    await parse_repo("https://github.com/owner/repo", "project", locale);
    assert.deepEqual(JSON.parse(String(requests[start + 1].init?.body)), {
      repo_url: "https://github.com/owner/repo", project_id: "project", locale,
    });

    await retry_history_item("insight", locale);
    const retry = requests[start + 2];
    assert.equal(new URL(retry.url).searchParams.get("locale"), locale);
    assert.equal(retry.init?.method, "POST");
  }
});

test("research survives API reads and edit responses use the server-owned research status", async (context) => {
  const analysis: AIAnalysis = {
    product_name: "Product", product_category: "", product_description: "", product_images: [],
    similar_products: [], strengths: [], weaknesses: [], product_summary: "Original summary",
    target_audience: "", use_cases: [], market_positioning: "", tech_highlights: [],
    suggested_marketing_angles: [], marketing_stage: "",
    research: {
      status: "completed", sources: [], claims: [], competitors: [], limitations: [],
      searched_at: "2026-10-02T09:00:00Z",
    },
  };
  const record: HistoryRecord = {
    id: "insight", filename: "product.md", file_size: 0, upload_time: "", source_type: "markdown",
    title: "Product", ai_model: "", ai_analysis: analysis, is_edited: false, status: "completed",
    owner_id: "user", organization_id: "org", project_id: "project", project_title: "Project",
    project_role: "owner",
  };
  context.mock.method(globalThis, "fetch", async (_input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === "PUT") {
      const body = JSON.parse(String(init.body));
      assert.equal(body.ai_analysis.product_summary, "Edited summary");
      return Response.json({
        success: true,
        data: { ...record, is_edited: true, ai_analysis: {
          ...body.ai_analysis, research: { ...analysis.research, status: "edited" },
        } },
      });
    }
    return Response.json({ success: true, data: record });
  });
  const fetched = await fetch_history_item("insight");
  assert.equal(fetched.data.ai_analysis?.research?.status, "completed");
  const edited = await update_history_item("insight", { ...analysis, product_summary: "Edited summary" });
  assert.equal(edited.data.ai_analysis?.research?.status, "edited");
});
