import assert from "node:assert/strict";
import test from "node:test";
import { agentStateObserver, createAgentStateObserver, type AgentState } from "./agent_state_observer.ts";
import { AgentTaskCancelledError, wait_for_agent_job } from "./content_generator_api.ts";
import type { ChatResponse } from "@/types/content_generator";

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
async function until(predicate: () => boolean) {
  for (let i = 0; i < 200; i++) {
    if (predicate()) return;
    await sleep(2);
  }
  assert.fail("Observation did not settle");
}
function snapshot(revision: number, status: "running" | "succeeded" | "cancelled" = "running", id = "job"): AgentState {
  return {
    job: {
      id, operation: "chat", status, attempts: 1, error: "", created_at: "", updated_at: "",
      result: status === "succeeded" ? {
        success: true, message: "", data: { session: { id: "session" }, reply: {}, intent: "explore" },
      } as ChatResponse : null,
    },
    progress: { revision, job_id: id, status, steps: [], messages: {}, events: [], active_stage: "",
      running: status === "running", failed: false },
  };
}

test("overlapping canvas and wait subscribers share one serial stream even with slow requests", async () => {
  let concurrent = 0;
  let maximum = 0;
  let calls = 0;
  const seen: number[][] = [[], []];
  const observer = createAgentStateObserver({
    activeDelay: 2, quietDelay: 4,
    fetchState: async (_session, signal, jobId) => {
      assert.ok(jobId === undefined || jobId === "job");
      maximum = Math.max(maximum, ++concurrent);
      try {
        await sleep(15);
        signal.throwIfAborted();
        return snapshot(++calls);
      } finally { concurrent--; }
    },
  });
  const first = observer.subscribe("session", { onState: state => seen[0].push(state.progress.revision) });
  const second = observer.subscribe("session", { jobId: "job", onState: state => seen[1].push(state.progress.revision) });
  try {
    await until(() => calls >= 3);
    assert.equal(maximum, 1);
    assert.deepEqual(seen[0], seen[1]);
    first();
    await until(() => calls >= 4);
    assert.equal(seen[0].length, 3);
  } finally { first(); second(); }
});

test("disposal aborts requests and session switches cannot deliver stale callbacks", async () => {
  let oldSignal: AbortSignal | undefined;
  let release: ((state: AgentState) => void) | undefined;
  const old: number[] = [];
  const current: number[] = [];
  const observer = createAgentStateObserver({
    activeDelay: 5,
    fetchState: async (session, signal) => {
      if (session === "old") {
        oldSignal = signal;
        return new Promise(resolve => { release = resolve; });
      }
      return snapshot(10);
    },
  });
  const stopOld = observer.subscribe("old", { onState: state => old.push(state.progress.revision) });
  await until(() => Boolean(release));
  stopOld();
  assert.ok(oldSignal?.aborted);
  const stopNew = observer.subscribe("new", { onState: state => current.push(state.progress.revision) });
  try {
    release!(snapshot(9));
    await until(() => current.length > 0);
    assert.deepEqual(old, []);
  } finally { stopNew(); }
  const count = current.length;
  await sleep(20);
  assert.equal(current.length, count);
});

test("stale revisions are ignored and explicit job subscribers never receive another job", async () => {
  let calls = 0;
  const revisions: number[] = [];
  const errors: string[] = [];
  const observer = createAgentStateObserver({
    activeDelay: 2,
    fetchState: async () => [snapshot(3), snapshot(2), snapshot(4, "running", "other"), snapshot(5)][Math.min(calls++, 3)],
  });

  const stop = observer.subscribe("session", {
    jobId: "job", onState: state => revisions.push(state.progress.revision),
    onError: error => errors.push(error.message),
  });
  try {
    await until(() => revisions.includes(5));
    assert.deepEqual(revisions, [3, 5]);
    assert.equal(errors.length, 1);
  } finally { stop(); }
});

test("latest-session snapshots cannot replace a revision with different content at the same revision", async () => {
  let calls = 0;
  const ids: string[] = [];
  const observer = createAgentStateObserver({
    activeDelay: 2, quietDelay: 4,
    fetchState: async () => [snapshot(3), snapshot(3, "running", "stale"), snapshot(4)][Math.min(calls++, 2)],
  });
  const stop = observer.subscribe("session", { onState: state => ids.push(state.job!.id) });
  try {
    await until(() => ids.length >= 2);
    assert.deepEqual(ids, ["job", "job"]);
  } finally { stop(); }
});

test("a superseded job completes its waiter without replaying its old snapshot into the current canvas", async () => {
  const queries: Array<string | undefined> = [];
  const canvas: string[] = [];
  const historical: number[] = [];
  const observer = createAgentStateObserver({
    activeDelay: 2, idleDelay: 10,
    fetchState: async (_session, _signal, jobId) => {
      queries.push(jobId);
      return jobId === "old" ? snapshot(2, "cancelled", "old") : snapshot(10, "running", "new");
    },
  });
  const stopCanvas = observer.subscribe("session", { onState: state => canvas.push(state.job!.id) });
  let stopOld = () => {};
  stopOld = observer.subscribe("session", {
    jobId: "old", onState: state => { historical.push(state.progress.revision); stopOld(); },
  });
  try {
    await until(() => historical.length > 0 && queries.length >= 3);
    assert.deepEqual(historical, [2]);
    assert.ok(canvas.every(id => id === "new"));
    assert.deepEqual(queries.slice(0, 3), [undefined, "old", undefined]);
  } finally { stopCanvas(); stopOld(); }
});

test("resubscribing while an aborted request settles cannot overlap it or deliver its stale response", async () => {
  let calls = 0;
  let active = 0;
  let maximum = 0;
  let release: (() => void) | undefined;
  const seen: number[] = [];
  const observer = createAgentStateObserver({
    activeDelay: 2,
    fetchState: async () => {
      maximum = Math.max(maximum, ++active);
      const revision = ++calls;
      if (calls === 1) await new Promise<void>(resolve => { release = resolve; });
      active--;
      return snapshot(revision);
    },
  });
  const first = observer.subscribe("session", { onState: () => assert.fail("disposed callback") });
  await until(() => Boolean(release));
  first();
  const second = observer.subscribe("session", { onState: state => seen.push(state.progress.revision) });
  try {
    release!();
    await until(() => seen.length > 0);
    assert.equal(maximum, 1);
    assert.deepEqual(seen, [2]);
  } finally { second(); }
});

test("network failures back off and retry; quiet activity adapts, idle and hidden observations slow down", async () => {
  const starts: number[] = [];
  let errors = 0;
  let count = 0;
  const observer = createAgentStateObserver({
    activeDelay: 10, quietDelay: 30, idleDelay: 40,
    fetchState: async () => {
      starts.push(performance.now());
      if (++count <= 2) throw new Error("Offline");
      return snapshot(count);
    },
  });
  const stop = observer.subscribe("session", { onState: () => {}, onError: () => { errors++; } });
  try {
    await until(() => count >= 3);
    assert.equal(errors, 2);
    assert.ok(starts[1] - starts[0] >= 16);
    assert.ok(starts[2] - starts[1] >= 35);
  } finally { stop(); }
  for (const [hidden, status, minimum] of [
    [false, "running", 25], [false, "succeeded", 35], [true, "running", 115],
  ] as const) {
    const times: number[] = [];
    const adaptive = createAgentStateObserver({
      activeDelay: 10, quietDelay: 30, idleDelay: 40, hidden: () => hidden,
      fetchState: async () => { times.push(performance.now()); return snapshot(1, status); },
    });
    const dispose = adaptive.subscribe("session", { onState: () => {} });
    try {
      await until(() => times.length >= (status === "running" && !hidden ? 4 : 2));
      const last = times.length - 1;
      assert.ok(times[last] - times[last - 1] >= minimum);
    } finally { dispose(); }
  }
});

test("request timeout aborts a stalled fetch and retries without overlap", async () => {
  let calls = 0;
  let aborted = false;
  let complete = false;
  const observer = createAgentStateObserver({
    timeout: 10, activeDelay: 2,
    fetchState: async (_session, signal) => {
      if (++calls > 1) return snapshot(2);
      return new Promise((_resolve, reject) => signal.addEventListener("abort", () => {
        aborted = true;
        reject(signal.reason);
      }, { once: true }));
    },
  });
  const stop = observer.subscribe("session", { onState: () => { complete = true; } });
  try { await until(() => complete); assert.ok(aborted); assert.equal(calls, 2); }
  finally { stop(); }
});

test("durable waiters share the canvas stream, resolve terminal success, reject cancellation and abort cleanly", async context => {
  let calls = 0;
  let status: "succeeded" | "cancelled" = "succeeded";
  context.mock.method(globalThis, "fetch", async () => {
    calls++;
    return Response.json({ success: true, data: snapshot(calls, status) });
  });
  const canvas: string[] = [];
  const dispose = agentStateObserver.subscribe("session", { onState: state => canvas.push(state.job!.status) });
  try {
    const [first, second] = await Promise.all([wait_for_agent_job("session", "job"), wait_for_agent_job("session", "job")]);
    assert.equal(first.data.session.id, "session");
    assert.deepEqual(first, second);
    assert.equal(calls, 1);
    assert.deepEqual(canvas, ["succeeded"]);
    status = "cancelled";
    await assert.rejects(wait_for_agent_job("session", "job"), AgentTaskCancelledError);
    const controller = new AbortController();
    const pending = wait_for_agent_job("session", "job", controller.signal);
    controller.abort();
    await assert.rejects(pending, { name: "AbortError" });
  } finally { dispose(); }
  const before = calls;
  await sleep(20);
  assert.equal(calls, before);
});

test("unmounting the last durable waiter aborts its in-flight HTTP request", async context => {
  let requestSignal: AbortSignal | undefined;
  context.mock.method(globalThis, "fetch", async (_input: RequestInfo | URL, init?: RequestInit) => {
    requestSignal = init?.signal || undefined;
    return new Promise<Response>((_resolve, reject) => requestSignal?.addEventListener("abort",
      () => reject(requestSignal?.reason), { once: true }));
  });
  const controller = new AbortController();
  const pending = wait_for_agent_job("session", "job", controller.signal);
  await until(() => Boolean(requestSignal));
  controller.abort();
  await assert.rejects(pending, { name: "AbortError" });
  assert.ok(requestSignal?.aborted);
});
