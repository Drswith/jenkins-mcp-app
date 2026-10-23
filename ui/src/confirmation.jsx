import React, { useState } from "react";
import { sendPrompt } from "./host.js";

export function Confirmation({ data, bridge }) {
  const [values, setValues] = useState(() => Object.fromEntries(data.parameters.map((item) => [item.name, item.value])));
  const [state, setState] = useState("ready");
  const [error, setError] = useState("");
  const [draft, setDraft] = useState("");
  const blocked = data.parameters.some((item) => item.blocked);
  async function confirm(event) {
    event.preventDefault();
    const text = `请运行 Jenkins 任务 ${JSON.stringify(data.jobFullName)}。我已确认以下最终参数：\n${JSON.stringify(values, null, 2)}\n请调用 triggerBuild 一次，并按宿主审批流程处理。`;
    setState("sending"); setError(""); setDraft(text);
    try { await sendPrompt(bridge, text); setState("sent"); }
    catch (cause) { setError(cause.message); setState("uncertain"); }
  }
  return <form onSubmit={confirm}>
    <p><strong>将以以下参数运行，可直接修改</strong></p>
    <div className="parameter-editor">{data.parameters.map((item) => <label key={item.name}>
      <span>{item.name}{values[item.name] !== item.defaultValue && !item.blocked && <small className="changed">已修改</small>}</span>
      {item.blocked ? <span>敏感或不支持的参数，请在 Jenkins 中填写</span> : item.type === "boolean" ? <input type="checkbox" checked={values[item.name] === true} disabled={state !== "ready"} onChange={(event) => setValues({ ...values, [item.name]: event.target.checked })} /> : item.type === "choice" ? <select value={values[item.name] ?? ""} required disabled={state !== "ready"} onChange={(event) => setValues({ ...values, [item.name]: event.target.value })}>{values[item.name] == null && <option value="" disabled>请选择</option>}{item.choices.map((choice) => <option key={choice} value={choice}>{choice || "（空字符串）"}</option>)}</select> : <input type="text" value={values[item.name] ?? ""} disabled={state !== "ready"} onChange={(event) => setValues({ ...values, [item.name]: event.target.value })} />}
      {!item.blocked && <small>默认 {item.defaultValue == null ? "未提供" : String(item.defaultValue) || "（空字符串）"}</small>}
    </label>)}</div>
    {!data.parameters.length && <p>此任务没有声明参数。</p>}
    <p className="subtle">此任务可能部署或修改外部系统。确认后由对话提交，并接受宿主审批。</p>
    <div className="inline-actions"><button type="submit" className="primary" disabled={blocked || state !== "ready" || data.parameters.some((item) => !item.blocked && values[item.name] == null)}>确认运行</button><button type="button" className="secondary" disabled={state !== "ready"} onClick={() => setState("cancelled")}>取消</button></div>
    {state === "sent" && <p role="status">最终参数已交回对话，尚未由本界面触发构建。</p>}
    {state === "cancelled" && <p role="status">已取消，未提交构建。</p>}
    {error && <><p className="inline-error" role="alert">{error}；为避免重复发送，本卡已停止提交。</p><textarea readOnly aria-label="最终运行请求" value={draft} /></>}
  </form>;
}
