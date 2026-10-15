import test from "node:test";
import assert from "node:assert/strict";
import { createAutoExpandController } from "../ui/src/display-mode.js";

const supportedContext = { displayMode: "inline", availableDisplayModes: ["inline", "fullscreen"] };

function flush() {
  return new Promise((resolve) => setImmediate(resolve));
}

test("waits for handshake and input in either order, then requests fullscreen once", async () => {
  let resolveRequest;
  const calls = [];
  const states = [];
  const controller = createAutoExpandController({
    requestDisplayMode(...args) {
      calls.push(args);
      return new Promise((resolve) => { resolveRequest = resolve; });
    },
  }, (state) => states.push(state));

  controller.update({ requested: true, context: supportedContext });
  assert.equal(controller.getState().status, "waiting");
  controller.update({ ready: true });
  assert.deepEqual(controller.getState(), { status: "requesting", fromMode: "inline" });
  await flush();
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], [{ mode: "fullscreen" }, { timeout: 5_000 }]);
  controller.update({ requested: true, ready: true, context: { ...supportedContext, displayMode: "fullscreen" } });
  assert.equal(calls.length, 1);

  resolveRequest({ mode: "fullscreen" });
  await flush();
  assert.deepEqual(controller.getState(), { status: "expanded", mode: "fullscreen", fromMode: "inline" });
  assert.ok(states.some(({ status, fromMode }) => status === "requesting" && fromMode === "inline"));
  assert.ok(states.some(({ status, fromMode }) => status === "expanded" && fromMode === "inline"));
});

test("handles handshake before the initial opt-in input", async () => {
  let calls = 0;
  const controller = createAutoExpandController({ requestDisplayMode: () => {
    calls += 1;
    return Promise.resolve({ mode: "fullscreen" });
  } });
  controller.update({ ready: true, context: supportedContext });
  assert.equal(controller.getState().status, "not-requested");
  controller.update({ requested: true });
  await flush();
  assert.equal(calls, 1);
  assert.deepEqual(controller.getState(), { status: "expanded", mode: "fullscreen", fromMode: "inline" });
});

test("waits for host context, then reports unsupported without retrying", async () => {
  let calls = 0;
  const controller = createAutoExpandController({ requestDisplayMode: () => { calls += 1; } });
  controller.update({ requested: true, ready: true });
  assert.equal(controller.getState().status, "waiting-context");
  controller.update({ context: { displayMode: "inline", availableDisplayModes: ["inline"] } });
  assert.deepEqual(controller.getState(), { status: "unsupported", reason: "fullscreen-unavailable" });
  controller.update({ context: supportedContext });
  assert.equal(calls, 0);
});

test("does not request when the host already reports fullscreen", () => {
  let calls = 0;
  const controller = createAutoExpandController({ requestDisplayMode: () => { calls += 1; } });
  controller.update({ ready: true, requested: true, context: { ...supportedContext, displayMode: "fullscreen" } });
  assert.deepEqual(controller.getState(), { status: "already-fullscreen", mode: "fullscreen" });
  assert.equal(calls, 0);
});

test("reports a host refusal and never retries", async () => {
  let calls = 0;
  const controller = createAutoExpandController({ requestDisplayMode: () => {
    calls += 1;
    return Promise.resolve({ mode: "inline" });
  } });
  controller.update({ ready: true, requested: true, context: supportedContext });
  await flush();
  assert.deepEqual(controller.getState(), { status: "not-applied", mode: "inline", reason: "host-kept-current-mode", fromMode: "inline" });
  controller.update({ context: supportedContext });
  assert.equal(calls, 1);
});

test("reports a rejected request and never retries", async () => {
  let calls = 0;
  const controller = createAutoExpandController({ requestDisplayMode: () => {
    calls += 1;
    return Promise.reject(new Error("host declined display change"));
  } });
  controller.update({ ready: true, requested: true, context: supportedContext });
  await flush();
  assert.deepEqual(controller.getState(), { status: "failed", reason: "rejected", fromMode: "inline" });
  controller.update({ context: supportedContext });
  assert.equal(calls, 1);
});

test("passes the SDK timeout and makes a rejected timed request terminal", async () => {
  let calls = 0;
  const controller = createAutoExpandController({ requestDisplayMode(_params, options) {
    calls += 1;
    assert.equal(options.timeout, 5_000);
    return Promise.reject(Object.assign(new Error("request timed out"), { code: -32001 }));
  } });
  controller.update({ ready: true, requested: true, context: supportedContext });
  await flush();
  assert.deepEqual(controller.getState(), { status: "failed", reason: "timeout", fromMode: "inline" });
  controller.update({ context: supportedContext });
  assert.equal(calls, 1);
});

test("opt-out never asks the host to change display mode", () => {
  let calls = 0;
  const controller = createAutoExpandController({ requestDisplayMode: () => { calls += 1; } });
  controller.update({ ready: true, requested: false, context: supportedContext });
  assert.equal(controller.getState().status, "not-requested");
  assert.equal(calls, 0);
});
