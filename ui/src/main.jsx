import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { App, applyDocumentTheme, applyHostStyleVariables } from "@modelcontextprotocol/ext-apps";
import { InlineCard } from "./inline.jsx";
import { createAutoExpandController } from "./display-mode.js";
import { Workspace } from "./workspace.jsx";
import { supportsExtension } from "./host.js";
import "./style.css";
import "./theme.css";

const mode = document.body.dataset.mode;
const bridge = new App({ name: "jenkins-plugin-ui", version: document.body.dataset.uiVersion }, { availableDisplayModes: mode === "workspace" ? ["fullscreen"] : ["inline", "fullscreen"] });
document.body.dataset.documentId = crypto.randomUUID();
const systemTheme = window.matchMedia("(prefers-color-scheme: dark)");
let hasHostTheme = false;
applyDocumentTheme(systemTheme.matches ? "dark" : "light");
systemTheme.addEventListener("change", (event) => { if (!hasHostTheme) applyDocumentTheme(event.matches ? "dark" : "light"); });

function applyHost(context = {}) {
  if (context.theme) { hasHostTheme = true; applyDocumentTheme(context.theme); }
  if (context.styles?.variables) applyHostStyleVariables(context.styles.variables);
  document.body.dataset.hostStyles = String(Boolean(context.styles?.variables && Object.keys(context.styles.variables).length));
  if (context.displayMode && !document.body.dataset.initialDisplayMode) document.body.dataset.initialDisplayMode = context.displayMode;
  if (context.displayMode) document.body.dataset.displayMode = context.displayMode;
  document.body.dataset.modelContext = String(supportsExtension(bridge, "openai/modelContext"));
  document.body.dataset.newMessage = String(supportsExtension(bridge, "openai/message"));
}
function resultData(result) {
  if (result?.isError) throw new Error(result.content?.find((item) => item.type === "text")?.text || "请求失败");
  if (result?._meta?.card) return result._meta.card;
  if (result?.structuredContent) return result.structuredContent;
  const text = result?.content?.find((item) => item.type === "text")?.text;
  if (!text) return {};
  try { return JSON.parse(text); } catch { throw new Error("返回的数据格式无法识别"); }
}
async function call(name, args = {}) { return resultData(await bridge.callServerTool({ name, arguments: args })); }

function Root() {
  const [ready, setReady] = useState(false);
  const [hostContext, setHostContext] = useState(null);
  const [error, setError] = useState("");
  const [input, setInput] = useState({});
  const [initial, setInitial] = useState(null);
  const [expand] = useState(() => createAutoExpandController(bridge, (state) => {
    document.body.dataset.autoExpandState = state.status;
    if (state.fromMode) document.body.dataset.autoExpandFrom = state.fromMode;
    if (state.reason) document.body.dataset.autoExpandReason = state.reason;
    if (state.mode) document.body.dataset.displayMode = state.mode;
  }));
  useEffect(() => {
    function contextChanged() {
      const context = bridge.getHostContext();
      applyHost(context); setHostContext(context);
    }
    bridge.onhostcontextchanged = contextChanged;
    bridge.ontoolinput = (value) => setInput(value.arguments || {});
    bridge.ontoolresult = (value) => { try { setInitial(resultData(value)); } catch (cause) { setError(cause.message); } };
    bridge.connect().then(() => { contextChanged(); setReady(true); }).catch((cause) => setError(cause.message || "无法连接宿主"));
  }, []);
  useEffect(() => {
    if (mode === "card") expand.update({ ready, requested: input.autoExpand ?? initial?.autoExpand ?? false, context: hostContext });
  }, [ready, hostContext, input.autoExpand, initial?.autoExpand, expand]);
  return mode === "card" ? <InlineCard ready={ready} initial={initial} input={input} hostError={error} call={call} bridge={bridge} hostContext={hostContext} /> : <Workspace ready={ready} call={call} bridge={bridge} hostError={error} hostContext={hostContext} />;
}
createRoot(document.getElementById("root")).render(<Root />);
