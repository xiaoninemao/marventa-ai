import assert from "node:assert/strict";
import test from "node:test";
import { autosaveIsBusy, DebouncedAutosave } from "./debounced_autosave.ts";

const unexpectedError = (reason: unknown) => { assert.fail(String(reason)); };

test("rapid edits are debounced into the latest value", async () => {
  const writes: string[] = [];
  const saver = new DebouncedAutosave(async (value: string) => { writes.push(value); }, () => {}, unexpectedError, 10);
  saver.queue("a");
  saver.queue("ab");
  saver.queue("abc");
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.deepEqual(writes, ["abc"]);
  assert.equal(saver.hasUnsavedChanges, false);
});

test("writes are serialized and edits during a request are not lost", async () => {
  const writes: string[] = [];
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const saver = new DebouncedAutosave(async (value: string) => {
    writes.push(value);
    if (value === "first") await gate;
  }, () => {}, unexpectedError);
  saver.queue("first");
  const saving = saver.flush();
  saver.queue("second");
  saver.queue("latest");
  const queued = saver.flush();
  release();
  await Promise.all([saving, queued]);
  assert.deepEqual(writes, ["first", "latest"]);
  assert.equal(saver.hasUnsavedChanges, false);
});

test("a failed request keeps the latest draft for retry without an automatic loop", async () => {
  const writes: string[] = [];
  const errors: unknown[] = [];
  let fail = true;
  const saver = new DebouncedAutosave(async (value: string) => {
    writes.push(value);
    if (fail) throw new Error("Offline");
  }, () => {}, (reason) => { errors.push(reason); });
  saver.queue("draft");
  await saver.flush();
  assert.equal(errors.length, 1);
  assert.equal(saver.hasUnsavedChanges, true);
  fail = false;
  await saver.flush();
  assert.deepEqual(writes, ["draft", "draft"]);
  assert.equal(saver.hasUnsavedChanges, false);
});

test("composition pauses saving and final composition can be flushed immediately", async () => {
  const writes: string[] = [];
  const saver = new DebouncedAutosave(async (value: string) => { writes.push(value); }, () => {}, unexpectedError, 10);
  saver.queue("before");
  saver.pause();
  saver.queue("composing");
  await saver.flush();
  assert.deepEqual(writes, []);
  saver.queue("complete");
  saver.resume();
  await saver.flush();
  assert.deepEqual(writes, ["complete"]);
});

test("a failed older request never replaces edits queued during that request", async () => {
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const writes: string[] = [];
  let fail = true;
  const saver = new DebouncedAutosave(async (value: string) => {
    writes.push(value);
    if (fail) { await gate; throw new Error("Offline"); }
  }, () => {}, () => {});
  saver.queue("old");
  const saving = saver.flush();
  saver.queue("new");
  release();
  await saving;
  assert.deepEqual(writes, ["old"]);
  fail = false;
  await saver.flush();
  assert.deepEqual(writes, ["old", "new"]);
});

test("flushing before navigation sends pending edits without waiting for debounce", async () => {
  const writes: string[] = [];
  const saver = new DebouncedAutosave(async (value: string) => { writes.push(value); }, () => {}, unexpectedError);
  saver.queue("final draft");
  await saver.flush();
  assert.deepEqual(writes, ["final draft"]);
});

test("publication locking retains pending input without timers, blur or composition writing", async () => {
  const writes: string[] = [];
  const saver = new DebouncedAutosave(async (value: string) => { writes.push(value); }, () => {}, unexpectedError, 10);
  saver.queue("unsaved draft");
  saver.setWritable(false);
  saver.resume();
  await saver.flush();
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.deepEqual(writes, []);
  assert.equal(saver.hasUnsavedChanges, true);
  saver.setWritable(true);
  await saver.flush();
  assert.deepEqual(writes, ["unsaved draft"]);
});

test("locking during an active write prevents the next queued write and retains it", async () => {
  const writes: string[] = [];
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const saver = new DebouncedAutosave(async (value: string) => {
    writes.push(value);
    await gate;
  }, () => {}, unexpectedError);
  saver.queue("in flight");
  const active = saver.flush();
  saver.queue("new local draft");
  saver.setWritable(false);
  release();
  await active;
  assert.deepEqual(writes, ["in flight"]);
  assert.equal(saver.hasUnsavedChanges, true);
  await saver.flush();
  assert.deepEqual(writes, ["in flight"]);
});

test("locked pending copy is unsaved but does not indefinitely block plan settings", () => {
  assert.equal(autosaveIsBusy("pending", true), true);
  assert.equal(autosaveIsBusy("pending", false), false);
  assert.equal(autosaveIsBusy("saving", false), true);
  assert.equal(autosaveIsBusy("saving", true), true);
  for (const state of ["idle", "saved", "error"] as const) {
    assert.equal(autosaveIsBusy(state, false), false);
    assert.equal(autosaveIsBusy(state, true), false);
  }
});
