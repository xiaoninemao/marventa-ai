import assert from "node:assert/strict";
import test from "node:test";
import { analyze_case } from "./case_library_api.ts";

test("case analysis sends the selected interface locale for both supported languages", async (context) => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  context.mock.method(globalThis, "fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    requests.push({ url: String(input), init });
    return Response.json({ success: true, message: "Started", data: { status: "analyzing" } });
  });
  for (const locale of ["zh-CN", "en"] as const) {
    const response = await analyze_case("case", locale);
    const request = requests.at(-1);
    assert.ok(request);
    assert.equal(new URL(request.url).searchParams.get("locale"), locale);
    assert.equal(request.init?.method, "POST");
    assert.equal(response.data.status, "analyzing");
  }
});
