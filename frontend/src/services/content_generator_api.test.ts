import assert from "node:assert/strict";
import test from "node:test";
import { fetch_session, send_chat_message } from "./content_generator_api.ts";

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
    client_message_id: "client-uuid", material_ids: ["material-1"],
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
