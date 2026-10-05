import assert from "node:assert/strict";
import test from "node:test";
import { fetch_account_content, fetch_account_content_accounts, fetch_account_content_player } from "./account_content_api.ts";
import type { AccountContentAccount, AccountContentPage } from "../types/account_content.ts";

const account: AccountContentAccount = {
  id: "account", project_id: "project", platform: "douyin", account_name: "QA", platform_user_id: "",
  profile_url: "", notes: "", created_by_user_id: "", creator_name: "", creator_avatar_url: "",
  authorization_status: "active", token_expires_at: "", refresh_token_expires_at: "",
  created_at: "", updated_at: "", project_title: "Project",
  content_status: "ready", required_scope: "video.list", content_message: "",
};
const page: AccountContentPage = {
  account, source: "platform", status: "ready", items: [], next_cursor: "9007199254740995",
  has_more: true, page: 2, page_size: 12, limited: false, message: "",
};
const options = { source: "platform", cursor: "9007199254740993", count: 12, page: 2 } as const;

test("account discovery is scoped to project and accepts an abort signal", async (context) => {
  const controller = new AbortController();
  context.mock.method(globalThis, "fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    assert.equal(url.pathname, "/api/v1/publishing/account-content/accounts");
    assert.equal(url.searchParams.get("project_id"), "project");
    assert.equal(init?.signal, controller.signal);
    return Response.json({ success: true, data: [account] });
  });
  assert.deepEqual((await fetch_account_content_accounts("project", controller.signal)).data, [account]);
});

test("large platform cursors stay strings and local records are requested explicitly", async (context) => {
  context.mock.method(globalThis, "fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    assert.equal(url.searchParams.get("cursor"), options.cursor);
    assert.equal(url.searchParams.get("count"), "12");
    assert.equal(url.searchParams.get("page"), "2");
    assert.equal(init?.cache, "no-store");
    return Response.json({ success: true, data: { ...page, source: url.searchParams.get("source") } });
  });
  assert.equal((await fetch_account_content("project", "account", options)).data.next_cursor, page.next_cursor);
  assert.equal((await fetch_account_content("project", "account", { ...options, source: "marventa" })).data.source, "marventa");
});

test("unavailable account capabilities remain explicit rather than empty ready results", async (context) => {
  context.mock.method(globalThis, "fetch", async () => Response.json({
    success: true, data: { ...page, status: "scope_required", has_more: false, next_cursor: null },
  }));
  assert.equal((await fetch_account_content("project", "account", options)).data.status, "scope_required");
});

test("four supported metrics retain reported values or null and reject invalid or missing values", async (context) => {
  let shares: unknown = null;
  context.mock.method(globalThis, "fetch", async () => Response.json({
    success: true, data: {
      ...page, items: [{
        id: "post", title: "Post", content: "", visibility: "published",
        statistics: { likes: 0, comments: null, views: 120, shares },
      }],
    },
  }));
  for (const value of [null, 0, 128]) {
    shares = value;
    const result = await fetch_account_content("project", "account", options);
    assert.equal(result.data.items[0].statistics.shares, value);
  }
  for (const value of [undefined, -1, "128", true]) {
    shares = value;
    await assert.rejects(fetch_account_content("project", "account", options), /response is invalid/);
  }
});

test("content responses preserve separate title and body and reject malformed body fields", async (context) => {
  let content: unknown = "First paragraph\nSecond paragraph";
  context.mock.method(globalThis, "fetch", async () => Response.json({
    success: true, data: { ...page, items: [{
      id: "post", title: "Separate title", content, visibility: "published",
      statistics: { likes: null, comments: null, views: null, shares: null },
    }] },
  }));
  const response = await fetch_account_content("project", "account", options);
  assert.equal(response.data.items[0].title, "Separate title");
  assert.equal(response.data.items[0].content, content);
  content = "";
  assert.equal((await fetch_account_content("project", "account", options)).data.items[0].content, "");
  for (const value of [undefined, null, 123, {}]) {
    content = value;
    await assert.rejects(fetch_account_content("project", "account", options), /response is invalid/);
  }
});

test("HTTP errors and malformed or cross-account responses never become empty results", async (context) => {
  let response = Response.json({ detail: "Access denied" }, { status: 403 });
  context.mock.method(globalThis, "fetch", async () => response.clone());
  await assert.rejects(fetch_account_content("project", "account", options), /Access denied/);
  for (const data of [
    { ...page, account: { ...account, id: "other" } },
    { ...page, account: { ...account, project_id: "other" } },
    { ...page, status: "invalid" }, { ...page, source: "marventa" },
    { ...page, next_cursor: options.cursor }, { ...page, account: null },
    { ...page, items: [{ id: "broken", title: "Broken metrics", visibility: "unknown", statistics: {} }] },
  ]) {
    response = Response.json({ success: true, data });
    await assert.rejects(fetch_account_content("project", "account", options), /response is invalid/);
  }
});

test("gallery responses preserve image order, accept cover-only records and reject malformed images", async (context) => {
  let images: unknown = ["https://cdn.example.com/first.jpg", "https://cdn.example.com/second.jpg"];
  context.mock.method(globalThis, "fetch", async () => Response.json({
    success: true, data: { ...page, items: [{
      id: "post", title: "Gallery", content: "Body", image_urls: images, visibility: "published",
      statistics: { likes: null, comments: null, views: null, shares: null },
    }] },
  }));
  assert.deepEqual((await fetch_account_content("project", "account", options)).data.items[0].image_urls, images);
  images = ["http://127.0.0.1:8765/media/snapshot/first.png", "http://127.0.0.1:8765/media/snapshot/second.png"];
  assert.deepEqual((await fetch_account_content("project", "account", options)).data.items[0].image_urls, images);
  for (const value of [undefined, []]) {
    images = value;
    await fetch_account_content("project", "account", options);
  }
  for (const value of [null, "url", [null], [1], [""]]) {
    images = value;
    await assert.rejects(fetch_account_content("project", "account", options), /response is invalid/);
  }
});

test("playable saved video URLs survive transport, and invalid video fields are rejected", async (context) => {
  let videoUrl: unknown = "http://127.0.0.1:8765/media/clip.mp4";
  context.mock.method(globalThis, "fetch", async () => Response.json({
    success: true, data: { ...page, items: [{
      id: "post", title: "Video", content: "", video_url: videoUrl, visibility: "accepted",
      statistics: { likes: null, comments: null, views: null, shares: null },
    }] },
  }));
  assert.equal((await fetch_account_content("project", "account", options)).data.items[0].video_url, videoUrl);
  for (const value of [undefined, ""]) {
    videoUrl = value;
    await fetch_account_content("project", "account", options);
  }
  for (const value of [null, 123, {}]) {
    videoUrl = value;
    await assert.rejects(fetch_account_content("project", "account", options), /response is invalid/);
  }
});

test("official player requests are scoped, abortable and use exact large video IDs", async (context) => {
  const videoId = "9007199254740993";
  const controller = new AbortController();
  const data = { video_id: videoId, player_url: `https://open.douyin.com/player/video?vid=${videoId}&autoplay=0` };
  context.mock.method(globalThis, "fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    assert.equal(url.pathname, "/api/v1/publishing/projects/project/channel-accounts/account/content/player");
    assert.equal(url.searchParams.get("video_id"), videoId);
    assert.equal(init?.signal, controller.signal);
    assert.equal(init?.cache, "no-store");
    return Response.json({ success: true, data });
  });
  assert.deepEqual((await fetch_account_content_player("project", "account", videoId, controller.signal)).data, data);
});

test("player URLs must be official, match the requested video and never enable autoplay or extra parameters", async (context) => {
  let response = Response.json({ detail: "Player unavailable" }, { status: 502 });
  context.mock.method(globalThis, "fetch", async () => response.clone());
  await assert.rejects(fetch_account_content_player("project", "account", "123"), /Player unavailable/);
  for (const playerUrl of [
    "", "javascript:alert(1)", "http://open.douyin.com/player/video?vid=123&autoplay=0",
    "https://attacker.example.com/player/video?vid=123&autoplay=0",
    "https://open.douyin.com/other?vid=123&autoplay=0",
    "https://user:password@open.douyin.com/player/video?vid=123&autoplay=0",
    "https://open.douyin.com/player/video?vid=456&autoplay=0",
    "https://open.douyin.com/player/video?vid=123&autoplay=1",
    "https://open.douyin.com/player/video?vid=123&autoplay=0&extra=1",
    "https://open.douyin.com/player/video?vid=123&autoplay=0#fragment",
  ]) {
    response = Response.json({ success: true, data: { video_id: "123", player_url: playerUrl } });
    await assert.rejects(fetch_account_content_player("project", "account", "123"), /response is invalid/);
  }
  response = Response.json({ success: true, data: null });
  await assert.rejects(fetch_account_content_player("project", "account", "123"), /response is invalid/);
});

test("platform video IDs are transported as strings rather than lossy numbers", async (context) => {
  let videoId: unknown = "9007199254740993";
  context.mock.method(globalThis, "fetch", async () => Response.json({
    success: true, data: { ...page, items: [{
      id: "post", title: "Video", content: "", platform_video_id: videoId, visibility: "published",
      statistics: { likes: null, comments: null, views: null, shares: null },
    }] },
  }));
  assert.equal((await fetch_account_content("project", "account", options)).data.items[0].platform_video_id, videoId);
  for (const value of [undefined, ""]) {
    videoId = value;
    await fetch_account_content("project", "account", options);
  }
  for (const value of [null, true, 123, "-1", "1e3", "0"]) {
    videoId = value;
    await assert.rejects(fetch_account_content("project", "account", options), /response is invalid/);
  }
});
