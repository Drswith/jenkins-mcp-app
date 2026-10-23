import React, { useEffect, useState } from "react";
import { StatusIcon, statusLabel } from "./status.jsx";
import { supportsExtension } from "./host.js";

export function LogLines({ lines = [], selected = [], onSelect }) {
  return <div className="log-lines" aria-label="日志证据">{lines.map((line) => <label key={line.number} className={selected.includes(line.number) ? "referenced" : ""}>
    {onSelect && <input type="checkbox" checked={selected.includes(line.number)} onChange={() => onSelect(line.number)} aria-label={`引用第 ${line.number} 行`} />}
    <span className="line-number">{line.number}</span><code>{line.text}{line.shortened ? " …（该行已截短）" : ""}</code>
  </label>)}</div>;
}

export function EvidenceView({ data, bridge, call, hostContext, close }) {
  const [evidence, setEvidence] = useState(null);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState([]);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const canAttach = Boolean(bridge.getHostCapabilities?.()?.updateModelContext?.text) && supportsExtension(bridge, "openai/modelContext");
  useEffect(() => {
    let disposed = false;
    call("uiGetBuildEvidence", { jobFullName: data.jobFullName, buildNumber: data.build.number })
      .then((value) => { if (!disposed) setEvidence(value); })
      .catch((cause) => { if (!disposed) setError(cause.message); });
    return () => { disposed = true; };
  }, [data.jobFullName, data.build.number, call]);
  useEffect(() => {
    const context = hostContext?.["openai/modelContext"];
    if (context === null) { setSelected([]); setNotice(""); }
  }, [hostContext?.["openai/modelContext"]]);
  async function attach() {
    setBusy(true); setError("");
    const lines = evidence.log.lines.filter((line) => selected.includes(line.number));
    try {
      const result = await bridge.updateModelContext({ content: lines.length ? [{ type: "text", text: `${data.jobFullName} #${data.build.number}\n${lines.map((line) => `${line.number}: ${line.text}`).join("\n")}`, _meta: { "openai/title": `#${data.build.number} 日志 ${lines.map((line) => line.number).join(", ")}` } }] : [] }, { timeout: 5000 });
      if (result?.isError) throw new Error("宿主未接受日志附件");
      setNotice(lines.length ? "已附加到输入框，可在宿主中移除" : "已移除日志附件");
    } catch (cause) { setError(cause.message); }
    finally { setBusy(false); }
  }
  return <main className="evidence">
    <header><span>{data.jobFullName} · #{data.build.number}</span><button className="secondary" onClick={close}>返回卡片</button></header>
    {error && <p className="inline-error" role="alert">{error}</p>}
    {!evidence ? <p>正在读取证据…</p> : <>
      <h1><StatusIcon status={evidence.build.building ? "IN_PROGRESS" : evidence.build.result} />#{data.build.number} · {statusLabel(evidence.build.building ? "IN_PROGRESS" : evidence.build.result)}</h1>
      <section><h2>阶段</h2>{evidence.stages.available ? <><p className="subtle">按接口返回顺序连接；未提供并行分支拓扑。</p><ol className="stage-graph">{evidence.stages.stages.map((stage, i) => <li key={stage.id ?? i}><StatusIcon status={stage.status} /><span>{stage.name}</span><small>{statusLabel(stage.status)}{Number.isFinite(stage.durationMillis) ? ` · ${(stage.durationMillis / 1000).toFixed(1)} 秒` : ""}</small></li>)}</ol></> : <p>{evidence.stages.reason === "permission_denied" ? "无权限读取阶段" : evidence.stages.reason === "not_found" ? "此构建没有阶段记录" : "阶段读取失败"}</p>}</section>
      <section><h2>日志证据</h2><p className="subtle">{evidence.log.error || `从已读取的 ${evidence.log.readLines} 行中截取${evidence.log.truncated ? "；日志超过 64 KiB，后续内容未读取" : ""}`}</p>
        <LogLines lines={evidence.log.lines} selected={selected} onSelect={(number) => setSelected((current) => current.includes(number) ? current.filter((n) => n !== number) : [...current, number])} />
        {canAttach ? <button className="primary" disabled={busy} onClick={attach}>{selected.length ? `引用 ${selected.length} 行` : "清除引用"}</button> : <p className="subtle">宿主未声明可移除附件支持，可复制带行号的日志到对话。</p>}
        {notice && <p role="status">{notice}</p>}
      </section>
      <section><h2>相对上次成功的变更</h2>{evidence.changes.available ? <><p className="subtle">成功基线 #{evidence.changes.baselineBuildNumber} · 来自各次构建记录的变更集</p>{evidence.changes.commits.length ? <ul className="changes">{evidence.changes.commits.map((commit, i) => <li key={i}><code className="commit">{commit.commitId?.slice(0, 8) || "无提交号"}</code><span>{commit.msg}</span><small>{commit.author}</small></li>)}</ul> : <p>该范围内没有返回变更记录；不代表代码没有变化。</p>}</> : <p>{evidence.changes.reason}</p>}</section>
    </>}
  </main>;
}
