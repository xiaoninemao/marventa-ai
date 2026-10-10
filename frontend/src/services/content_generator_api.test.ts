import assert from "node:assert/strict";
import test from "node:test";
import {
  fetch_session,
  create_session,
  restore_work_version,
  regenerate_latest_reply,
  rewrite_latest_reply,
  send_chat_message,
  AgentTaskCancelledError,
  wait_for_agent_job,
  cancel_agent_job,
  fetch_active_agent_job,
  save_creation_work,
} from "./content_generator_api.ts";

test("saving a work calls the native endpoint and returns its saved identity without report fields", async (context) => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  context.mock.method(globalThis, "fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    requests.push({ url: String(input), init });
    return Response.json({ success: true, data: { source_session_id: "session/name", status: "completed", work_id: "work" } });
  });
  const saved = await save_creation_work("session/name");
  assert.ok(requests[0].url.endsWith("/sessions/session%2Fname/save-work"));
  assert.equal(requests[0].init?.method, "POST");
  assert.equal(saved.data.work_id, "work");
  context.mock.method(globalThis, "fetch", async () => Response.json({ detail: "Work changed; reload and try again" }, { status: 409 }));
  await assert.rejects(save_creation_work("session"), /Work changed/);
});

test("chat sends material IDs last without changing the legacy client message ID position", async (context) => {
  const requests: RequestInit[] = [];
  context.mock.method(globalThis, "fetch", async (_input: RequestInfo | URL, init?: RequestInit) => {
    requests.push(init || {});
    const session = { material_ids: ["material-1"], messages: [
        { role: "user", references: [{ id: "material-1", kind: "material", title: "Product photo" }] },
      ] };
    return Response.json({ success: true, data: init?.method === "POST" ? { session } : session });
  });

  const response = await send_chat_message("session", "message", ["insight"], ["case"], ["tone"], "client-uuid", ["material-1"]);
  assert.deepEqual(JSON.parse(String(requests[0].body)), {
    message: "message", insight_ids: ["insight"], case_ids: ["case"], preference_keys: ["tone"],
    client_message_id: "client-uuid", material_ids: ["material-1"], agent_mode: "auto",
  });
  assert.deepEqual(response.data.session.material_ids, ["material-1"]);
  assert.equal(response.data.session.messages[0].references?.[0].kind, "material");
  await send_chat_message("session", "legacy", [], [], [], "legacy-uuid");
  assert.equal(JSON.parse(String(requests[1].body)).client_message_id, "legacy-uuid");
  assert.deepEqual(JSON.parse(String(requests[1].body)).material_ids, []);
  const persisted = await fetch_session("session");
  assert.deepEqual(persisted.data.material_ids, ["material-1"]);
});

test("failed chat requests preserve the caller's material reference snapshot for retry", async (context) => {
  const ids = ["material-1"];
  const payloads: unknown[] = [];
  context.mock.method(globalThis, "fetch", async (_input: RequestInfo | URL, init?: RequestInit) => {
    payloads.push(JSON.parse(String(init?.body)));
    return Response.json({ detail: "Could not send message" }, { status: 503 });
  });

  await assert.rejects(send_chat_message("session", "message", [], [], [], "retry-uuid", ids));
  assert.deepEqual(ids, ["material-1"]);
  await assert.rejects(send_chat_message("session", "message", [], [], [], "retry-uuid", ids));
  assert.deepEqual(payloads[0], payloads[1]);
});

test("reply replacement keeps the selected Agent mode", async (context) => {
  const requests: RequestInit[] = [];
  context.mock.method(globalThis, "fetch", async (_input: RequestInfo | URL, init?: RequestInit) => {
    requests.push(init || {});
    return Response.json({
      success: true,
      data: { reply: {}, session: {}, intent: "explore", deliverable: null },
    });

    test("creation type, one image reference and restore head are explicit requests", async (context) => {
      const payloads: unknown[] = [];
      context.mock.method(globalThis, "fetch", async (_input: RequestInfo | URL, init?: RequestInit) => {
        payloads.push(JSON.parse(String(init?.body)));
        return Response.json({ success: true, data: {} });
      });
      await create_session("project", "Video", "video");
      await send_chat_message("session", "Replace this image", [], [], [], "id", [], "create",
        { deliverable_id: "work", index: 1 });
      await restore_work_version("session", "old", "current");
      assert.deepEqual(payloads[0], { project_id: "project", title: "Video", creation_kind: "video" });
      assert.deepEqual((payloads[1] as { image_reference: unknown }).image_reference,
        { deliverable_id: "work", index: 1 });
      assert.deepEqual(payloads[2], { expected_version_id: "current" });
    });
  });
  await regenerate_latest_reply("session", "create");
  await rewrite_latest_reply("session", "Rewritten", "explore");
  assert.deepEqual(JSON.parse(String(requests[0].body)), {
    agent_mode: "create",
  });
  assert.deepEqual(JSON.parse(String(requests[1].body)), {
    message: "Rewritten",
    agent_mode: "explore",
  });
});

test("background chat waits for the durable result instead of accepting the queued response as success", async (context) => {
  const urls: string[] = [];
  const result = { success: true, message: "Done", data: {
    reply: { role: "assistant", content: "Ready" }, session: { id: "session" }, intent: "explore",
  } };
  context.mock.method(globalThis, "fetch", async (input: RequestInfo | URL) => {
    urls.push(String(input));
    if (urls.length === 1) return Response.json({ data: { job: { id: "job", status: "queued" } } }, { status: 202 });
    const status = urls.length === 2 ? "running" : "succeeded";
    return Response.json({ data: {
      job: { id: "job", status, result: status === "succeeded" ? result : null },
      progress: { revision: urls.length, job_id: "job", status, events: [], running: status === "running" },
    } });
  });
  const response = await send_chat_message("session", "Hello", [], [], [], "id");
  assert.equal(response.data.reply.content, "Ready");
  assert.match(urls[0], /\/chat\?background=true$/);
  assert.match(urls[1], /\/agent-state\?job_id=job$/);
  assert.equal(urls.length, 3);
});

test("durable jobs expose cancellation and reconnect without creating another model request", async (context) => {
  const calls: Array<{ url: string; method?: string }> = [];
  context.mock.method(globalThis, "fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, method: init?.method });
    return Response.json({ data: { id: "job", status: url.endsWith("/cancel") ? "cancelling" : "running" } });
  });
  assert.equal((await fetch_active_agent_job("session"))?.id, "job");
  assert.equal((await cancel_agent_job("session", "job")).status, "cancelling");
  assert.match(calls[0].url, /agent-jobs\/active$/);
  assert.match(calls[1].url, /agent-jobs\/job\/cancel$/);
  assert.equal(calls[1].method, "POST");
});

test("cancelled, interrupted, timeout and malformed jobs never look successful", async (context) => {
  let status = "cancelled";
  context.mock.method(globalThis, "fetch", async () =>
    Response.json({ data: {
      job: { id: "job", status, result: null, error: "Agent task timed out" },
      progress: { revision: 1, job_id: "job", status, events: [], running: false },
    } }));
  await assert.rejects(wait_for_agent_job("session", "job"), AgentTaskCancelledError);
  for (status of ["interrupted", "timed_out", "succeeded", "unknown"]) {
    await assert.rejects(wait_for_agent_job("session", "job"));
  }
});
