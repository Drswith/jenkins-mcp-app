import React, { useCallback, useEffect, useRef, useState } from "react";
import { ArrowUpRight, CheckCircle2, CircleAlert, Clock3, ExternalLink, LoaderCircle, RefreshCw, Sparkles } from "lucide-react";
import "./inline.css";

function statusOf(build, color) {
  if (build?.building || String(color ?? "").endsWith("_anime")) return "运行中";
  const result = String(build?.result ?? "").toUpperCase();
  return { SUCCESS: "成功", FAILURE: "失败", UNSTABLE: "不稳定", ABORTED: "已中止", NOT_BUILT: "未构建" }[result] ?? { blue: "成功", red: "失败", yellow: "不稳定" }[color] ?? "状态未知";
}

function duration(ms) {
  if (!Number.isFinite(ms) || ms < 0) return "—";
  const seconds = Math.floor(ms / 1000);
  return `${Math.floor(seconds / 60)} 分 ${String(seconds % 60).padStart(2, "0")} 秒`;
}

function evidenceFrom(log) {
  const lines = String(log).split(/\r?\n/).filter(Boolean);
  const matches = lines.filter((line) => /(?:\berror\b|\bfailed\b|\bexception\b|\bfatal\b|失败|错误)/i.test(line) && !/^Finished: /i.test(line));
  return (matches.length ? matches.slice(-3) : lines.slice(-3)).map((line) => line.slice(0, 240)).join("\n") || "日志中没有可显示的内容。";
}

function StatusMark({ status }) {
  const Icon = status === "成功" ? CheckCircle2 : status === "运行中" ? LoaderCircle : status === "排队中" ? Clock3 : CircleAlert;
  const tone = status === "成功" ? "ok" : ["失败", "不稳定", "已中止", "已取消"].includes(status) ? "bad" : "pending";
  return <span className={`inline-status ${tone}`}><Icon size={17} className={status === "运行中" ? "inline-status-spin" : undefined} aria-hidden="true" />{status}</span>;
}

function stageTone(status) {
  if (status === "SUCCESS") return "done";
  if (["IN_PROGRESS", "PAUSED_PENDING_INPUT"].includes(status)) return "current";
  if (["FAILED", "ABORTED", "UNSTABLE"].includes(status)) return "bad";
  return "pending";
}

function stageStatusLabel(status, ended) {
  return { SUCCESS: "已完成", IN_PROGRESS: "运行中", PAUSED_PENDING_INPUT: "等待审批输入", FAILED: "失败", ABORTED: "已中止", UNSTABLE: "不稳定", NOT_EXECUTED: ended ? "已跳过" : "待执行", QUEUED: "排队中" }[status] ?? "状态未知";
}

function BuildStages({ stages, build }) {
  if (stages === undefined) return <p className="inline-stage-unavailable">正在读取 Pipeline 阶段…</p>;
  if (stages?.available === false) return <p className="inline-stage-unavailable">{stages.reason === "request_failed" ? `阶段读取失败：${stages.message || "请求失败"}` : stages.reason === "permission_denied" || stages.reason === "permission-denied" ? "无权限读取 Pipeline 阶段" : stages.reason === "not_found" ? "此构建没有可用的 Pipeline 阶段信息" : "此任务类型暂不支持 Pipeline 阶段"}</p>;
  const stageList = Array.isArray(stages) ? stages : stages?.stages;
  if (!stageList?.length) return <p className="inline-stage-unavailable">{build?.building ? "正在运行 · Jenkins 未提供阶段信息" : "此构建没有阶段记录"}</p>;
  const ended = !build?.building;
  const current = stageList.find((stage) => ["IN_PROGRESS", "PAUSED_PENDING_INPUT"].includes(stage.status));
  const failed = stageList.find((stage) => ["FAILED", "ABORTED", "UNSTABLE"].includes(stage.status));
  const summary = current ? `${current.status === "PAUSED_PENDING_INPUT" ? "等待审批输入" : "当前阶段"}：${current.name}` : failed ? `异常阶段：${failed.name}` : ended ? "阶段记录" : "当前阶段待 Jenkins 更新";
  return <div className="inline-stage-block" aria-label="Pipeline 阶段状态">
    <div className="inline-stage-summary"><span>{summary}</span></div>
    <div className="inline-stage-track" role="list" aria-label="各阶段状态">
      {stageList.map((stage, index) => <span key={`${stage.name}-${index}`} role="listitem" className={stageTone(stage.status)} title={`${stage.name}：${stageStatusLabel(stage.status, ended)}`} aria-label={`${stage.name}：${stageStatusLabel(stage.status, ended)}`} />)}
    </div>
    <div className="inline-stages">{stageList.map((stage, index) => <span key={`${stage.name}-${index}`} className={stageTone(stage.status)} title={`${stage.name}：${stageStatusLabel(stage.status, ended)}`}>{stage.name} · {stageStatusLabel(stage.status, ended)}</span>)}</div>
  </div>;
}

export function InlineCard({ ready, initial, input, hostError, call, bridge }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState(null);
  const [logOpen, setLogOpen] = useState(false);
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
    setLog(null); setLogOpen(false); setError(""); setNotice("");
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
    try {
      const result = await bridge.sendMessage({ role: "user", content: [{ type: "text", text: prompt }] });
      if (result?.isError) throw new Error("宿主未接受这条提问");
      setNotice("已发送到当前对话");
    } catch (cause) { setError(cause.message); }
  }

  async function open(url) {
    if (!url) return;
    try {
      const result = await bridge.openLink({ url });
      if (result?.isError) throw new Error("宿主未打开 Jenkins 链接");
    } catch (cause) { setError(cause.message); }
  }

  async function toggleEvidence() {
    if (logOpen) { setLogOpen(false); return; }
    setLogOpen(true);
    if (log !== null || data?.view !== "card") return;
    const current=dataRef.current;
    try { const result=await call("uiGetBuildLog", { jobFullName: current.jobFullName, buildNumber: current.build.number }); if(dataRef.current?.jobFullName===current.jobFullName&&dataRef.current?.build?.number===current.build.number)setLog(result); }
    catch (cause) { if(dataRef.current?.jobFullName===current.jobFullName&&dataRef.current?.build?.number===current.build.number){setError(cause.message);setLog({ log: "日志读取失败" });} }
  }

  const issue = hostError || error;
  if (!ready || !data) return <main className="inline-shell"><div className="inline-card inline-loading">{issue || (ready ? "正在读取 Jenkins 数据…" : "正在连接宿主…")}</div></main>;

  const jobName = data.jobFullName;
  let body;
  if (data.view === "queue") {
    const queue = data.queue ?? {};
    const cancelled = Boolean(queue.cancelled);
    const expired = Boolean(queue.expired);
    body = <>
      <div className="inline-main-status"><StatusMark status={cancelled ? "已取消" : expired ? "队列项已过期" : "排队中"} /><span className="inline-id">队列 #{data.queueId}</span></div>
      <p className="inline-subtext">{cancelled ? "Jenkins 已取消此队列项。" : expired ? "队列记录已过期，未找到关联构建。" : queue.why || "等待 Jenkins 分配执行器"}</p>
      {!cancelled && !expired && <div className="inline-steps" aria-label="构建进度"><span className="done">已提交</span><span className="current">排队中</span><span>运行中</span><span>完成</span></div>}
      {!cancelled && !expired && <div className="inline-actions"><button type="button" onClick={refresh} disabled={busy}><RefreshCw size={15} />{busy ? "正在刷新" : "刷新状态"}</button></div>}
    </>;
  } else if (data.view === "card") {
    const build = data.build;
    const status = statusOf(build);
    const elapsed = build.building && Number.isFinite(build.timestamp) ? Math.max(0, now - build.timestamp) : build.duration;
    body = <>
      <div className="inline-main-status"><StatusMark status={status} /><span className="inline-id">#{build.number} · {duration(elapsed)}</span></div>
      <BuildStages stages={stages} build={build} />
      {!build.building && <p className="inline-subtext">{build.description || `构建${status}。`}</p>}
      {["失败", "不稳定"].includes(status) && <div className="inline-evidence"><button type="button" className="inline-disclosure" aria-expanded={logOpen} onClick={toggleEvidence}>{logOpen ? "收起日志证据" : "查看日志证据"}</button>{logOpen && <><pre>{log === null ? "正在读取日志…" : evidenceFrom(log.log)}</pre>{log?.truncated && <small>只读取了日志前 64 KiB；可能还有后续内容。</small>}</>}</div>}
      <div className="inline-actions">
        {build.building ? <button type="button" onClick={refresh} disabled={busy}><RefreshCw size={15} />{busy ? "正在刷新" : "刷新状态"}</button> : <button type="button" onClick={() => ask(`请分析 Jenkins 任务 ${jobName} 的构建 #${build.number}，依据 Jenkins 构建数据和日志说明${status === "成功" ? "结果与下一步" : "失败或异常原因、证据与下一步"}。`)}><Sparkles size={15} />{status === "成功" ? "让 Codex 总结" : "让 Codex 分析"}</button>}
        {build.url && <button type="button" className="secondary" onClick={() => open(build.url)}><ExternalLink size={15} />在 Jenkins 打开</button>}
      </div>
    </>;
  } else if (data.view === "choices") {
    const jobs = (data.jobs ?? []).filter((job) => {
      const result = statusOf(job.lastBuild, job.color);
      return data.filter === "all" || (data.filter === "failed" && ["失败", "不稳定"].includes(result)) || (data.filter === "running" && result === "运行中");
    }).slice(0, 5);
    body = <><p className="inline-subtext">{data.filter === "failed" ? "选择一个异常任务继续排查" : "选择一个任务查看最近构建"}</p><div className="inline-choices">{jobs.length ? jobs.map((job) => <button type="button" key={job.fullName || job.name} onClick={() => ask(`请查看 Jenkins 任务 ${job.fullName || job.name} 的最近一次构建状态。`)}><span>{job.fullName || job.name}</span><StatusMark status={statusOf(job.lastBuild, job.color)} /><ArrowUpRight size={14} /></button>) : <p>没有符合条件的任务。</p>}</div></>;
  } else if (data.view === "comparison") {
    body = <><p className="inline-subtext">同一任务的两次构建</p><div className="inline-compare">{[data.before, data.after].map((build, index) => <div key={build.number}><small>{index === 0 ? "之前" : "之后"} · #{build.number}</small><StatusMark status={statusOf(build)} /><span>{duration(build.duration)}</span></div>)}</div><div className="inline-actions"><button type="button" onClick={() => ask(`请比较 Jenkins 任务 ${jobName} 的构建 #${data.before.number} 和 #${data.after.number}，依据构建记录、提交和日志说明可证实的差异。`)}><Sparkles size={15} />让 Codex 比较</button>{data.after.url && <button type="button" className="secondary" onClick={() => open(data.after.url)}><ExternalLink size={15} />打开新构建</button>}</div></>;
  } else body = <p className="inline-subtext">暂不支持此卡片类型。</p>;

  return <main className="inline-shell"><section className="inline-card" aria-label="Jenkins 内联卡片"><header><strong>{data.view === "comparison" ? "构建对比" : data.view === "choices" ? "选择任务" : "构建"}</strong>{jobName && <span title={jobName}>{jobName}</span>}</header>{body}{active && <small className="inline-updated">打开期间自动刷新 · 上次更新 {updatedAt ? `${Math.max(0, Math.floor((now - updatedAt) / 1000))} 秒前` : "刚刚"}</small>}{notice && <div className="inline-notice" role="status">{notice}</div>}{issue && <div className="inline-error" role="alert">{issue}</div>}</section></main>;
}
