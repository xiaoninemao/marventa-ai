import assert from "node:assert/strict";
import test from "node:test";
import {
  accept_opinion_action,
  download_daily_comment_report,
  fetch_lead_tracking_analysis,
  fetch_lead_tracking_comment_insight,
  fetch_lead_tracking_works,
  fetch_opinion_overview,
  fetch_opinion_details,
  fetch_opinion_actions,
  generate_opinion_strategy,
  update_opinion_action,
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

test("opinion overview requests an account window without a work filter", async (context) => {
  let data: unknown = overview;
  context.mock.method(globalThis, "fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    assert.equal(url.pathname, "/api/v1/publishing/projects/project/channel-accounts/account/lead-tracking/opinion-overview");
    assert.equal(url.searchParams.get("days"), "7");
    assert.equal(url.searchParams.has("item_id"), false);
    assert.equal(init?.cache, "no-store");
    return Response.json({ success: true, data });
  });
  assert.deepEqual((await fetch_opinion_overview("project", "account", 7)).data, overview);
  data = { ...overview, question_percent: 140 };
  await assert.rejects(fetch_opinion_overview("project", "account", 7), /response is invalid/);
});

test("opinion details keep scoped post metrics and full comment evidence typed", async (context) => {
  const details = {
    period_days: 7, is_simulated: false,
    performance: { post_count: 1, views: 1000, engagement: 100, risk_count: 1,
      daily: Array.from({ length: 7 }, (_, index) => ({
        date: `2026-10-${String(index + 5).padStart(2, "0")}`, views: 100 + index,
        engagement: 10 + index, previous_views: null, previous_engagement: null,
      })) },
    posts: [{ item_id: "post-1", title: "Product demo", share_url: "", published_at: "2026-10-11T08:00:00Z",
      platform: "douyin", views: 1000, engagement: 100, rate: 10, summary: "Two comments" }],
    comments: [{ comment_id: "comment-1", item_id: "post-1", item_title: "Product demo", share_url: "",
      author: "User 8A1F", content: "Export is slow", created_at: "2026-10-11 16:00", likes: 12, replies: 3,
      topic: "Reports", mood: "negative", review_required: false, evidence: ["negative_feedback"],
      platform: "douyin" }],
  };
  let data: unknown = details;
  context.mock.method(globalThis, "fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    assert.equal(url.pathname, "/api/v1/publishing/projects/project/channel-accounts/account/lead-tracking/opinion-details");
    assert.equal(url.searchParams.get("days"), "7");
    assert.equal(init?.cache, "no-store");
    return Response.json({ success: true, data });
  });
  assert.deepEqual((await fetch_opinion_details("project", "account", 7)).data, details);
  data = { ...details, comments: [{ ...details.comments[0], evidence: [42] }] };
  await assert.rejects(fetch_opinion_details("project", "account", 7), /response is invalid/);
});

test("opinion follow-up stays scoped and strategy uses an explicit POST", async (context) => {
  const actions = {
    period_days: 7, start_date: "2026-10-06", end_date: "2026-10-12",
    is_simulated: false, report_days: 1, pending_review_comments: 1,
    negative_feedback_comments: 0, llm_available: true,
    actions: [{ id: "a1", topic: "报表与数据", status: "accepted", completed: false,
      latest_date: "2026-10-12", source_dates: ["2026-10-12"], report_count: 1,
      conclusion: "需要改进", product_suggestion: "核对流程", marketing_suggestion: "整理问答",
      evidence_comment_ids: ["c1"] }],
  };
  const strategy = { status: "completed", period_days: 7, headline: "先核对报表需求",
    recommendations: [{ title: "访谈用户", next_step: "确认使用场景", rationale: "已有评论记录",
      evidence_action_ids: ["a1"], source_dates: ["2026-10-12"] }] };
  const methods: string[] = [];
  context.mock.method(globalThis, "fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    assert.equal(url.pathname.startsWith("/api/v1/publishing/projects/project/channel-accounts/account/lead-tracking/"), true);
    assert.equal(url.searchParams.get("days"), "7");
    methods.push(init?.method || "GET");
    if (init?.method === "PATCH") assert.deepEqual(JSON.parse(String(init.body)), { action_id: "a1", completed: true });
    if (url.pathname.endsWith("opinion-actions/accept")) assert.deepEqual(JSON.parse(String(init?.body)), { action_id: "a1" });
    return Response.json({ success: true, data: url.pathname.endsWith("opinion-strategy") ? strategy : actions });
  });
  assert.deepEqual((await fetch_opinion_actions("project", "account", 7)).data, actions);
  assert.deepEqual((await update_opinion_action("project", "account", 7, "a1", true)).data, actions);
  assert.deepEqual((await accept_opinion_action("project", "account", 7, "a1")).data, actions);
  assert.deepEqual((await generate_opinion_strategy("project", "account", 7)).data, strategy);
  assert.deepEqual(methods, ["GET", "PATCH", "POST", "POST"]);
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

test("account works are loaded separately and comment ranking is requested within the selected work", async (context) => {
  const requests: URL[] = [];
  const works = [{ item_id: "item-1", title: "Product video", share_url: "" }];
  context.mock.method(globalThis, "fetch", async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    requests.push(url);
    return Response.json({ success: true, data: url.pathname.endsWith("/works") ? works : insight });
  });
  assert.deepEqual(await fetch_lead_tracking_works("project", "account"), works);
  await fetch_lead_tracking_comment_insight("project", "account", "2026-10-04", undefined, "item-1");
  assert.equal(requests[0].pathname.endsWith("/lead-tracking/works"), true);
  assert.equal(requests[1].searchParams.get("item_id"), "item-1");
});

test("daily report export follows the selected work", async (context) => {
  const requests: URL[] = [];
  context.mock.method(globalThis, "fetch", async (input: RequestInfo | URL) => {
    requests.push(new URL(String(input)));
    return new Response("report", { status: 200 });
  });
  await download_daily_comment_report("project", "account", "2026-10-04", "md", "item-1");
  assert.equal(requests[0].searchParams.get("item_id"), "item-1");
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
