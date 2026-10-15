import test from "node:test";
import assert from "node:assert/strict";
import { request } from "../src/api.js";

const config = {
  baseUrl: new URL("https://jenkins.example.test/"),
  authorization: "Basic test-secret-token",
};

function response(status = 200) {
  return new Response("{}", { status });
}

test("GET retries one time after a whitelisted transient network error", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    if (calls === 1) throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNRESET" } });
    return response();
  };

  const result = await request(config, "job/example/api/json");
  assert.equal(result.status, 200);
  assert.equal(calls, 2);
});

test("POST does not retry a transient network error and reports only its safe code", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    throw Object.assign(new TypeError("fetch failed with token=secret"), {
      cause: { code: "ECONNRESET", message: "https://jenkins.example.test/?token=secret" },
    });
  };

  await assert.rejects(request(config, "job/example/build?token=query-secret", { method: "POST", body: "x=y" }), (error) => {
    assert.equal(error.message, "Jenkins network request failed (ECONNRESET)");
    assert.doesNotMatch(error.message, /secret|token|jenkins\.example\.test/);
    return true;
  });
  assert.equal(calls, 1);
});

test("HTTP errors are returned without retry", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  let calls = 0;
  for (const status of [403, 404, 500]) {
    calls = 0;
    globalThis.fetch = async () => { calls += 1; return response(status); };
    await assert.rejects(request(config, "job/example/api/json"), { message: `Jenkins returned HTTP ${status}` });
    assert.equal(calls, 1);
  }
});

test("a repeated GET connection failure stops after two attempts", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    throw Object.assign(new TypeError("fetch failed"), { cause: { code: "UND_ERR_CONNECT_TIMEOUT" } });
  };
  await assert.rejects(request(config, "api/json"), { message: "Jenkins network request failed (UND_ERR_CONNECT_TIMEOUT)" });
  assert.equal(calls, 2);
});

test("unknown fetch errors get a safe network diagnostic without exposing cause details", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    throw Object.assign(new TypeError("fetch failed token=top-secret"), {
      cause: { code: "PRIVATE_ERROR", message: "https://internal.example.test/?api_token=hidden" },
    });
  };

  await assert.rejects(request(config, "job/example/api/json?api_token=query-secret"), (error) => {
    assert.equal(error.message, "Jenkins network request failed; check connectivity to the controller");
    assert.doesNotMatch(error.message, /secret|hidden|PRIVATE_ERROR|internal\.example\.test/);
    return true;
  });
  assert.equal(calls, 1);
});

test("request timeouts use a safe timeout label", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async () => {
    throw Object.assign(new TypeError("fetch failed"), { cause: new DOMException("private detail", "TimeoutError") });
  };

  await assert.rejects(request(config, "job/example/api/json"), { message: "Jenkins request timed out after 30 seconds" });
});
