const REQUEST_TIMEOUT_MS = 5_000;

function timeoutError(error) {
  return error?.name === "AbortError" || error?.code === -32001 || /tim(?:e|ed) ?out/i.test(error?.message || "");
}

/**
 * Coordinates an opt-in fullscreen request with the MCP Apps handshake and
 * tool input/result notifications, which may arrive in either order.
 */
export function createAutoExpandController(bridge, onState = () => {}) {
  let ready = false;
  let requested = false;
  let context;
  let attempted = false;
  let state = { status: "waiting" };

  function publish(next) {
    if (state.status === next.status && state.mode === next.mode && state.reason === next.reason && state.fromMode === next.fromMode) return;
    state = next;
    try { onState({ ...state }); } catch { /* Observability must not affect app behavior. */ }
  }

  function update(next = {}) {
    if (Object.hasOwn(next, "ready")) ready = Boolean(next.ready);
    if (Object.hasOwn(next, "requested")) requested = next.requested === true;
    if (Object.hasOwn(next, "context")) context = next.context;

    if (attempted) return;
    if (!requested) {
      publish({ status: "not-requested" });
      return;
    }
    if (!ready) {
      publish({ status: "waiting" });
      return;
    }
    if (context == null) {
      publish({ status: "waiting-context" });
      return;
    }

    if (context.displayMode === "fullscreen") {
      attempted = true;
      publish({ status: "already-fullscreen", mode: "fullscreen" });
      return;
    }
    if (!Array.isArray(context.availableDisplayModes) || !context.availableDisplayModes.includes("fullscreen")) {
      attempted = true;
      publish({ status: "unsupported", reason: "fullscreen-unavailable" });
      return;
    }
    if (typeof bridge?.requestDisplayMode !== "function") {
      attempted = true;
      publish({ status: "unsupported", reason: "request-api-unavailable" });
      return;
    }

    attempted = true;
    const fromMode = context.displayMode;
    publish({ status: "requesting", fromMode });
    Promise.resolve()
      .then(() => bridge.requestDisplayMode({ mode: "fullscreen" }, { timeout: REQUEST_TIMEOUT_MS }))
      .then((result) => {
        if (result?.mode === "fullscreen") publish({ status: "expanded", mode: "fullscreen", fromMode });
        else publish({ status: "not-applied", mode: result?.mode, reason: "host-kept-current-mode", fromMode });
      })
      .catch((error) => publish({
        status: "failed",
        reason: timeoutError(error) ? "timeout" : "rejected",
        fromMode,
      }));
  }

  return { update, getState: () => ({ ...state }) };
}
