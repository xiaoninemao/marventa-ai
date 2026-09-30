import assert from "node:assert/strict";
import test from "node:test";
import { parse_files, parse_repo, retry_history_item } from "./market_insight_api.ts";

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
