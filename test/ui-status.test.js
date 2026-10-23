import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { renderToStaticMarkup } from "react-dom/server";
import React from "react";

const compiled = await build({ entryPoints: ["ui/src/status.jsx"], bundle: true, write: false, platform: "node", format: "esm" });
const { estimatedProgress, StatusIcon } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString("base64")}`);

test("progress is bounded and never invented without a previous duration", () => {
  assert.equal(estimatedProgress(500, 1000), 50);
  assert.equal(estimatedProgress(2000, 1000), 99);
  for (const value of [0, null, undefined, -1, NaN]) assert.equal(estimatedProgress(1000, value), null);
  assert.equal(estimatedProgress(-1, 1000), null);
});

test("status symbols expose accessible labels and distinct semantic tones", () => {
  for (const [status, tone] of [["SUCCESS", "success"], ["FAILURE", "danger"], ["UNSTABLE", "warning"], ["QUEUED", "info"], ["ABORTED", "secondary"]]) {
    const html = renderToStaticMarkup(React.createElement(StatusIcon, { status }));
    assert.match(html, new RegExp(`tone-${tone}`));
    assert.match(html, /role="img" aria-label="[^"]+"/);
  }
  const html = renderToStaticMarkup(React.createElement(StatusIcon, { status: "IN_PROGRESS" }));
  assert.ok(!html.includes("stroke-dashoffset"));
});
