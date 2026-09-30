import assert from "node:assert/strict";
import test from "node:test";
import { startPolling } from "./polling.ts";

const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

test("polling continues through transient errors without repeated error notifications", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  let attempts = 0;
  let errors = 0;
  const results: string[] = [];
  const stop = startPolling({
    load: async () => {
      attempts += 1;
      if (attempts <= 2 || attempts === 4) throw new Error("Disconnected");
      return attempts === 3 ? "analyzing" : "failed";
    },
    onResult: (status) => {
      results.push(status);
      return status === "analyzing";
    },
    onError: () => { errors += 1; },
  });
  for (let index = 0; index < 6; index += 1) {
    context.mock.timers.tick(3000);
    await flush();
  }
  assert.equal(attempts, 5);
  assert.equal(errors, 2);
  assert.deepEqual(results, ["analyzing", "failed"]);
  stop();
});

test("polling never overlaps requests and ignores results after cleanup", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  let resolve: (value: string) => void = () => {};
  let loads = 0;
  let results = 0;
  const stop = startPolling({
    load: () => {
      loads += 1;
      return new Promise<string>((done) => { resolve = done; });
    },
    onResult: () => { results += 1; return true; },
    onError: () => assert.fail("Unexpected error"),
  });
  context.mock.timers.tick(3000);
  context.mock.timers.tick(30000);
  assert.equal(loads, 1);
  stop();
  resolve("completed");
  await flush();
  context.mock.timers.tick(30000);
  assert.equal(results, 0);
  assert.equal(loads, 1);
});

test("cleanup suppresses late errors and stops future polling", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  let reject: (reason: Error) => void = () => {};
  let loads = 0;
  const stop = startPolling({
    load: () => {
      loads += 1;
      return new Promise<string>((_, fail) => { reject = fail; });
    },
    onResult: () => assert.fail("Unexpected result"),
    onError: () => assert.fail("Error after unmount"),
  });
  context.mock.timers.tick(3000);
  stop();
  reject(new Error("Disconnected"));
  await flush();
  context.mock.timers.tick(30000);
  assert.equal(loads, 1);
});
