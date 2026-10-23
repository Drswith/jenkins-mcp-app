import React, { useCallback, useEffect, useRef, useState } from "react";
import { StatusIcon, statusLabel, buildStatus } from "./status.jsx";
import { Confirmation } from "./confirmation.jsx";
import { EvidenceView, LogLines } from "./evidence.jsx";
import { sendPrompt } from "./host.js";
import "./inline.css";

function statusOf(build, color) {
  if (build?.building || String(color ?? "").endsWith("_anime")) return "运行中";
  const result = String(build?.result ?? "").toUpperCase();
  return { SUCCESS: "成功", FAILURE: "失败", UNSTABLE: "不稳定", ABORTED: "已中止", NOT_BUILT: "未构建" }[result] ?? { blue: "成功", red: "失败", yellow: "不稳定" }[color] ?? "状态未知";
}

// Model-visible results replace Jenkins `color` with `status` and `building`.
function jobStatusOf(job) {
  if (job?.building) return "运行中";
  const fromStatus = { success: "成功", failure: "失败", unstable: "不稳定", aborted: "已中止", notBuilt: "未构建" }[job?.status];
  const fromBuild = statusOf(job?.lastBuild, job?.color);
  return fromBuild !== "状态未知" ? fromBuild : fromStatus ?? fromBuild;
}

function duration(ms) {
  if (!Number.isFinite(ms) || ms < 0) return "—";
  const seconds = Math.floor(ms / 1000);
  return `${Math.floor(seconds / 60)} 分 ${String(seconds % 60).padStart(2, "0")} 秒`;
}

function StatusMark({ build, status, elapsed }) {
  const value = status ?? buildStatus(build);
  return <span className="inline-status"><StatusIcon status={value} elapsed={elapsed} previousDuration={build?.previousBuild?.duration} /><strong>{statusLabel(value)}</strong></span>;
}

function BuildStages({ stages, build }) {
  if (!stages) return <p className="inline-subtext">正在读取阶段…</p>;
  if (stages.available === false) return <p className="inline-subtext">{stages.reason === "permission_denied" ? "无权限读取阶段" : stages.reason === "request_failed" ? "阶段读取失败" : "没有可用的阶段信息"}</p>;
  return <ol className="inline-stages" aria-label="阶段状态">{(stages.stages ?? []).map((stage, i) => <li key={i}><StatusIcon status={stage.status} label={`${stage.name}：${stage.status === "NOT_EXECUTED" && build.building ? "待执行" : statusLabel(stage.status)}`} /><span>{stage.name}</span></li>)}</ol>;
}

export function InlineCard({ ready, initial, input, hostError, call, bridge, hostContext }) {
  const [fullscreen, setFullscreen] = useState(false);
  const [draft, setDraft] = useState("");
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState(null);
  const [selectedJob, setSelectedJob] = useState("");
  const [stages, setStages] = useState(undefined);
  const [notice, setNotice] = useState("");
  const [updatedAt, setUpdatedAt] = useState(0);
  const [now, setNow] = useState(Date.now());
  const dataRef = useRef(null);
  const busyRef = useRef(false);
  const stageBuildRef = useRef("");

  function update(next) {
    dataRef.current = next;
    setData(next);
    setUpdatedAt(Date.now());
  }

  useEffect(() => {
    if (!ready) return;
    if (initial?.view) { update(initial); return; }
    if (!input?.jobFullName) return;
    const args = { jobFullName: input.jobFullName, ...(input.buildNumber ? { buildNumber: input.buildNumber } : {}) };
    let disposed = false;
    const timer = window.setTimeout(() => {
      call("uiGetBuild", args).then((build) => { if (!disposed) update({ view: "card", jobFullName: input.jobFullName, build }); }).catch((cause) => { if (!disposed) setError(cause.message); });
    }, 1000);
    return () => { disposed = true; window.clearTimeout(timer); };
  }, [ready, initial, input?.jobFullName, input?.buildNumber]);

  useEffect(() => {
    setLog(null); setFullscreen(false); setSelectedJob(""); setError(""); setNotice("");
  }, [data?.view, data?.jobFullName, data?.build?.number]);

  const refresh = useCallback(async () => {
    const current = dataRef.current;
    if (!current || busyRef.current) return;
    if (!["queue", "card"].includes(current.view)) return;
    busyRef.current = true;
    setBusy(true); setError("");
    try {
      if (current.view === "queue") {
        const tracked = await call("uiTrackQueue", { jobFullName: current.jobFullName, queueId: current.queueId });
        if (dataRef.current !== current) return;
        update(tracked);
      } else {
        const build = await call("uiGetBuild", { jobFullName: current.jobFullName, buildNumber: current.build.number });
        if (dataRef.current !== current) return;
        update({ ...current, build });
      }
    } catch (cause) { if (dataRef.current === current) setError(cause.message || "状态刷新失败"); }
    finally { busyRef.current = false; setBusy(false); }
  }, [call]);

  const active = data?.view === "queue" ? !data.queue?.cancelled && !data.queue?.expired : data?.view === "card" && Boolean(data.build?.building);
  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => { if (!document.hidden) refresh(); }, 6000);
    return () => window.clearInterval(timer);
  }, [active, refresh]);
  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [active]);

  useEffect(() => {
    if (!ready || data?.view !== "card") return;
    const buildKey = `${data.jobFullName}#${data.build.number}`;
    if (stageBuildRef.current !== buildKey) { stageBuildRef.current = buildKey; setStages(undefined); }
    let disposed = false;
    call("uiGetBuildStages", { jobFullName: data.jobFullName, buildNumber: data.build.number })
      .then((result) => { if (!disposed) setStages(result); })
      .catch((cause) => { if (!disposed) setStages({ available: false, reason: "request_failed", message: cause.message }); });
    return () => { disposed = true; };
  }, [ready, data?.view, data?.jobFullName, data?.build?.number, updatedAt]);

  async function ask(prompt) {
    setDraft(prompt);
    try { await sendPrompt(bridge, prompt); setNotice("已发送到当前对话"); setDraft(""); }
    catch (cause) { setError(cause.message); }
  }

  async function showEvidence() {
    if (!hostContext?.availableDisplayModes?.includes("fullscreen")) { setError("宿主未提供全屏模式，可在 Jenkins 打开查看完整证据"); return; }
    try {
      const result = await bridge.requestDisplayMode({ mode: "fullscreen" }, { timeout: 5000 });
      if (result?.mode !== "fullscreen") throw new Error("宿主未进入全屏，可在 Jenkins 打开查看完整证据");
      setFullscreen(true);
    } catch (cause) { setError(cause.message); }
  }

  async function closeEvidence() {
    try {
      const result = await bridge.requestDisplayMode({ mode: "inline" }, { timeout: 5000 });
      if (result?.mode !== "inline") throw new Error("宿主未收起全屏");
      setFullscreen(false);
    } catch (cause) { setError(cause.message); }
  }
  useEffect(() => { if (hostContext?.displayMode === "inline") setFullscreen(false); }, [hostContext?.displayMode]);

  async function open(url) {
    if (!url) return;
    try {
      const result = await bridge.openLink({ url });
      if (result?.isError) throw new Error("宿主未打开 Jenkins 链接");
    } catch (cause) { setError(cause.message); }
  }

  useEffect(() => {
    if (!ready || data?.view !== "card" || !["FAILURE", "UNSTABLE"].includes(data.build?.result)) return;
    let disposed = false;
    call("uiGetBuildEvidence", { jobFullName: data.jobFullName, buildNumber: data.build.number })
      .then((result) => { if (!disposed) setLog(result.log); })
      .catch((cause) => { if (!disposed) setError(cause.message); });
    return () => { disposed = true; };
  }, [ready, data?.view, data?.jobFullName, data?.build?.number]);

  const issue = hostError || error;
  if (!ready || !data) return <main className="inline-shell"><div className="inline-card inline-loading">{issue || (ready ? "正在读取构建…" : "正在连接宿主…")}</div></main>;

  if (fullscreen && data.view === "card") return <EvidenceView data={data} bridge={bridge} call={call} hostContext={hostContext} close={closeEvidence} />;
  const jobName = data.jobFullName;
  let body;
  if (data.view === "confirmation") {
    body = <Confirmation key={JSON.stringify(data)} data={data} bridge={bridge} />;
  } else if (data.view === "queue") {
    const queue = data.queue ?? {};
    const ended = queue.cancelled || queue.expired;
    body = <>
      <div className="inline-main-status"><StatusMark status={queue.cancelled ? "ABORTED" : queue.expired ? "NOT_BUILT" : "QUEUED"} /><strong>队列 #{data.queueId}</strong></div>
      <p className="inline-subtext">{queue.cancelled ? "队列项已取消。" : queue.expired ? "队列记录已过期，未找到关联构建。" : queue.why || "等待分配执行器"}</p>
      {!ended && <div className="inline-actions"><button className="primary" onClick={refresh} disabled={busy}>{busy ? "正在刷新" : "刷新状态"}</button>{queue.task?.url && <button className="secondary" onClick={() => open(queue.task.url)}>在 Jenkins 打开</button>}</div>}
    </>;
  } else if (data.view === "card") {
    const build = data.build;
    const status = statusOf(build);
    const elapsed = build.building && Number.isFinite(build.timestamp) ? Math.max(0, now - build.timestamp) : build.duration;
    body = <>
      <div className="inline-main-status"><StatusMark build={build} elapsed={elapsed} /><strong>#{build.number}</strong><span>{duration(elapsed)}</span></div>
      {build.building && <p className="inline-subtext">{build.previousBuild?.duration > 0 ? `进度为估算 · 上次耗时 ${duration(build.previousBuild.duration)}` : "尚无上次耗时，无法估算进度"}</p>}
      <BuildStages stages={stages} build={build} />
      {!build.building && build.description && <p className="inline-subtext">{build.description}</p>}
      {log && <LogLines lines={log.lines} />}
      {log?.error && <p className="inline-error">日志读取失败</p>}
      {log?.truncated && <small>日志仅包含前 64 KiB。</small>}
      <div className="inline-actions">
        {build.building ? <button className="primary" onClick={refresh} disabled={busy}>刷新状态</button> : <button className="primary" onClick={showEvidence}>查看证据</button>}
        {build.url && <button className="secondary" onClick={() => open(build.url)}>在 Jenkins 打开</button>}
      </div>
    </>;
  } else if (data.view === "choices") {
    const jobs = (data.jobs ?? []).filter((job) => data.filter === "all" || (data.filter === "failed" ? ["失败", "不稳定"].includes(jobStatusOf(job)) : jobStatusOf(job) === "运行中")).slice(0, 5);
    body = <><p className="inline-subtext">选择一个任务继续排查</p><fieldset className="inline-choices"><legend className="sr-only">任务</legend>{jobs.length ? jobs.map((job) => {
      const name = job.fullName || job.name;
      return <label key={name}><input type="radio" name="job" value={name} checked={selectedJob === name} onChange={() => setSelectedJob(name)} /><span>{name}</span><small>{jobStatusOf(job)}</small></label>;
    }) : <p>没有符合条件的任务。</p>}</fieldset>{jobs.length > 0 && <div className="inline-actions"><button className="primary" disabled={!selectedJob} onClick={() => ask(`请查看 Jenkins 任务 ${selectedJob} 的最近一次构建状态。`)}>查看构建</button></div>}</>;
  } else if (data.view === "comparison") {
    body = <><p className="inline-subtext">两次构建的结果与耗时</p><div className="inline-compare">{[data.before, data.after].map((build, index) => <div key={build.number}><small>{index === 0 ? "之前" : "之后"} · #{build.number}</small><StatusMark build={build} /><span>{duration(build.duration)}</span></div>)}</div><div className="inline-actions"><button className="primary" onClick={() => ask(`请比较 Jenkins 任务 ${jobName} 的构建 #${data.before.number} 和 #${data.after.number}，依据构建记录、提交和日志说明可证实的差异。`)}>让 Codex 比较</button>{data.after.url && <button className="secondary" onClick={() => open(data.after.url)}>在 Jenkins 打开</button>}</div></>;
  } else body = <p>暂不支持此卡片类型。</p>;

  return <main className="inline-shell"><section className="inline-card" aria-label="构建卡片"><header>{jobName || (data.view === "comparison" ? "构建对比" : "选择任务")}</header>{body}{active && <small className="inline-updated">可见时自动刷新 · {updatedAt ? `${Math.max(0, Math.floor((now - updatedAt) / 1000))} 秒前更新` : "刚刚更新"}</small>}{notice && <div role="status">{notice}</div>}{issue && <div className="inline-error" role="alert">{issue}</div>}{draft && <textarea readOnly aria-label="待发送请求" value={draft} />}</section></main>;
}
