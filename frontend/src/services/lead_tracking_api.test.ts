import assert from "node:assert/strict";
import test from "node:test";
import {
  fetch_daily_comment_report,
  fetch_lead_tracking_analysis,
  fetch_lead_tracking_comment_insight,
  fetch_project_opinion_monitor,
  generate_project_opinion_strategy,
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

const overview = {
  status: "completed" as const, period_days: 7 as const,
  start_date: "2026-10-05", end_date: "2026-10-11", timezone: "Asia/Shanghai",
  is_simulated: false, covered_days: 7, incomplete_days: 0,
  comments_collected: 2, distinct_users: 2, last_synced_at: "2026-10-12T00:00:00Z",
  daily: [{ date: "2026-10-11", comments: 2, negative_percent: 50 }],
  question_percent: 50, demand_percent: 50,
  sentiments: [{ key: "negative", label: "负向", count: 1, percent: 50 }],
  themes: [{ key: "0", label: "报表", count: 2, percent: 100 }],
  words: [{ word: "报表", weight: 1 }],
  keyword_clusters: [{ key: "0", label: "报表与数据", count: 2, percent: 100, keywords: ["报表"] }],
  theme_status: "ready" as const,
};

test("project monitoring uses the project endpoint and validates every account's provenance", async (context) => {
    const details = {
      period_days: 7, is_simulated: false,
      performance: { post_count: 2, views: 3000, engagement: 300, risk_count: 0,
        daily: Array.from({ length: 7 }, (_, index) => ({
          date: `2026-10-${String(index + 5).padStart(2, "0")}`,
          views: null, engagement: null, previous_views: null, previous_engagement: null,
        })) },
      posts: ["account-a", "account-b"].map((id) => ({
        item_id: `${id}:post`, title: id, share_url: "", published_at: "",
        platform: "douyin", views: 1500, engagement: 150, rate: 10, summary: "",
        account_id: id, account_name: id, project_id: "p/x",
      })),
      comments: [{
        comment_id: "account-a:comment", item_id: "account-a:post", item_title: "Product demo",
        share_url: "", author: "User 8A1F", content: "Export is slow", created_at: "2026-10-11 16:00",
        likes: 12, replies: 3, topic: "Reports", mood: "negative", review_required: false,
        evidence: ["negative_feedback"], platform: "douyin", account_id: "account-a",
        account_name: "account-a", project_id: "p/x",
      }],
    };
    const actions = { period_days: 7, start_date: overview.start_date, end_date: overview.end_date,
      is_simulated: false, report_days: 0, pending_review_comments: 0,
      negative_feedback_comments: 0, actions: [], llm_available: false };
    let data: unknown = { overview, details, actions };
    const abort = new AbortController();
    context.mock.method(globalThis, "fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      assert.equal(new URL(String(input)).pathname, "/api/v1/publishing/projects/p%2Fx/opinion-monitor");
      assert.equal(new URL(String(input)).searchParams.get("days"), "7");
      assert.equal(init?.signal, abort.signal);
      assert.equal(init?.cache, "no-store");
      return Response.json({ success: true, data });
    });
    assert.equal((await fetch_project_opinion_monitor("p/x", 7, abort.signal)).data.details.posts.length, 2);
    data = { overview: { ...overview, status: "partial" }, details, actions };
    assert.equal((await fetch_project_opinion_monitor("p/x", 7, abort.signal)).data.overview.status, "partial");
    for (const invalid of [
      { overview: { ...overview, demand_percent: 200 }, details, actions },
      { overview: { ...overview, question_percent: 140 }, details, actions },
      { overview, details: { ...details, comments: [{ ...details.comments[0], evidence: [42] }] }, actions },
      { overview, details: { ...details, posts: [{ ...details.posts[0], project_id: "other" }] }, actions },
      { overview, details: { ...details, posts: [{ ...details.posts[0], account_id: "" }] }, actions },
      { overview, details, actions: { ...actions, report_days: 9 } },
    ]) {
      data = invalid;
      await assert.rejects(fetch_project_opinion_monitor("p/x", 7, abort.signal), /response is invalid/);
    }
});

test("project strategy remains explicit and does not fall back to a selected account", async (context) => {
    const strategy = { status: "insufficient_data", period_days: 30, headline: "", recommendations: [] };
    context.mock.method(globalThis, "fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      assert.equal(new URL(String(input)).pathname, "/api/v1/publishing/projects/project/opinion-strategy");
      assert.equal(new URL(String(input)).searchParams.get("days"), "30");
      assert.equal(init?.method, "POST");
      return Response.json({ success: true, data: strategy });
    });
    assert.deepEqual((await generate_project_opinion_strategy("project", 30)).data, strategy);
});

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

test("daily reports retain latest and historical account reads without retired controls", async (context) => {
  const report = {
    status: "completed", date: "2026-10-04", topics: [], top_comments: [],
    semantic_status: "rules_only", collection_complete: true, is_simulated: false,
    comments_collected: 0, distinct_users: 0, purchase_intent_comments: 0,
    feature_request_comments: 0, negative_feedback_comments: 0,
    negated_comments: 0, pending_review_comments: 0,
  };
  let data: unknown = report;
  const controller = new AbortController();
  const requests: URL[] = [];
  context.mock.method(globalThis, "fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    requests.push(url);
    assert.equal(url.pathname, "/api/v1/publishing/projects/p%2Fx/channel-accounts/a%2Fx/lead-tracking/daily-reports");
    assert.equal(init?.cache, "no-store");
    assert.equal(init?.signal, controller.signal);
    return Response.json({ success: true, data });
  });
  assert.deepEqual((await fetch_daily_comment_report("p/x", "a/x", "", controller.signal)).data, report);
  await fetch_daily_comment_report("p/x", "a/x", "2026-10-04", controller.signal);
  assert.equal(requests[0].search, "");
  assert.equal(requests[1].searchParams.get("date"), "2026-10-04");
  for (const invalid of [null, { ...report, topics: [{}] }, { ...report, comments_collected: -1 }]) {
    data = invalid;
    await assert.rejects(fetch_daily_comment_report("p/x", "a/x", "", controller.signal), /response is invalid/);
  }
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
