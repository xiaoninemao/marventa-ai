import assert from "node:assert/strict";
import test from "node:test";
import {
  fetch_lead_tracking_analysis,
  fetch_lead_tracking_comment_insight,
  review_lead_tracking_item,
  run_lead_tracking_analysis,
} from "./lead_tracking_api.ts";

const item = {
  comment_id: "comment-1", comment_user_id: "user-1", content: "Need enterprise pricing",
  create_time: 1791158400, digg_count: 10, reply_comment_total: 2, top: false,
  item_id: "item-1", interaction_score: 14,
};
const insight = {
  status: "completed" as const, date: "2026-10-04", timezone: "Asia/Shanghai",
  top_limit: 50, items: [item], is_simulated: false, limited: false,
  message: "", last_synced_at: "2026-10-05T00:00:10Z",
};
const analysis = {
  status: "completed" as const, date: "2026-10-04", timezone: "Asia/Shanghai",
  analysis_method: "rules" as const, model: "",
  rule_version: "comment-intent-v1", is_simulated: false,
  analyzed_count: 1, high_count: 1, medium_count: 0, low_count: 0, pending_count: 1,
  generated_at: "2026-10-05T00:00:10Z", message: "",
  items: [{
    comment_id: "comment-1", comment_user_id: "user-1", content: "Need enterprise pricing",
    create_time: 1791158400, item_id: "item-1", score: 88, intent: "high" as const,
    demand_labels: ["pricing"], evidence: ["purchase_intent"], recommended_action: "send_pricing",
    review_status: "pending" as const, reviewed_at: "",
  }],
};

test("comment insight requests are scoped, no-store and preserve exact snapshot data", async (context) => {
  const controller = new AbortController();
  context.mock.method(globalThis, "fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    assert.equal(url.pathname, "/api/v1/publishing/projects/project/channel-accounts/account/lead-tracking/comment-insights");
    assert.equal(url.searchParams.get("date"), "2026-10-04");
    assert.equal(init?.signal, controller.signal);
    assert.equal(init?.cache, "no-store");
    return Response.json({ success: true, data: insight });
  });
  assert.deepEqual((await fetch_lead_tracking_comment_insight("project", "account", "2026-10-04", controller.signal)).data, insight);
});

test("invalid statuses, dates, limits and comments never become valid empty insights", async (context) => {
  let data: unknown = null;
  context.mock.method(globalThis, "fetch", async () => Response.json({ success: true, data }));
  for (const value of [
    null, { ...insight, status: "unknown" }, { ...insight, date: "2026/10/04" },
    { ...insight, top_limit: 100 }, { ...insight, items: [null] },
    { ...insight, is_simulated: "false" },
    { ...insight, items: [{ ...item, digg_count: -1 }] },
    { ...insight, items: [{ ...item, top: 1 }] },
    { ...insight, items: [{ ...item, interaction_score: 13.5 }] },
  ]) {
    data = value;
    await assert.rejects(fetch_lead_tracking_comment_insight("project", "account"), /response is invalid/);
  }
});

test("provider HTTP failures remain explicit", async (context) => {
  context.mock.method(globalThis, "fetch", async () => Response.json({ detail: "Snapshot unavailable" }, { status: 502 }));
  await assert.rejects(fetch_lead_tracking_comment_insight("project", "account"), /Snapshot unavailable/);
});

test("lead analysis GET, POST and review requests remain scoped and typed", async (context) => {
  const requests: Array<{ url: URL; init?: RequestInit }> = [];
  context.mock.method(globalThis, "fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    requests.push({ url: new URL(String(input)), init });
    return Response.json({ success: true, data: analysis });
  });
  assert.deepEqual(
    (await fetch_lead_tracking_analysis("project", "account", "2026-10-04")).data,
    analysis,
  );
  await run_lead_tracking_analysis("project", "account", "2026-10-04");
  await review_lead_tracking_item("project", "account", "comment/1", "confirmed", "2026-10-04");
  assert.equal(requests[0].init?.cache, "no-store");
  assert.equal(requests[1].init?.method, "POST");
  assert.equal(requests[2].init?.method, "PATCH");
  assert.equal(requests[2].url.pathname.endsWith("/analysis/comment%2F1"), true);
  assert.equal(requests[2].url.searchParams.get("date"), "2026-10-04");
  assert.deepEqual(JSON.parse(String(requests[2].init?.body)), { status: "confirmed" });
});

test("invalid lead analysis fields never become trusted results", async (context) => {
  let data: unknown = null;
  context.mock.method(globalThis, "fetch", async () => Response.json({ success: true, data }));
  for (const value of [
    null, { ...analysis, status: "running" }, { ...analysis, is_simulated: "false" },
    { ...analysis, analysis_method: "ai", model: "" },
    { ...analysis, analysis_method: "rules", model: "unexpected" },
    { ...analysis, analyzed_count: 2 }, { ...analysis, high_count: 0 },
    { ...analysis, items: [{ ...analysis.items[0], score: 101 }] },
    { ...analysis, items: [{ ...analysis.items[0], demand_labels: [1] }] },
    { ...analysis, items: [{ ...analysis.items[0], review_status: "accepted" }] },
  ]) {
    data = value;
    await assert.rejects(fetch_lead_tracking_analysis("project", "account"), /response is invalid/);
  }
});

test("explicit failed analysis responses remain retryable states", async (context) => {
  const failed = {
    ...analysis,
    status: "failed" as const,
    items: [],
    analyzed_count: 0,
    high_count: 0,
    medium_count: 0,
    low_count: 0,
    pending_count: 0,
    message: "Lead analysis failed; retry is available",
  };
  context.mock.method(globalThis, "fetch", async () => Response.json({
    success: true, data: failed,
  }));
  assert.deepEqual(
    (await fetch_lead_tracking_analysis("project", "account")).data,
    failed,
  );
});
