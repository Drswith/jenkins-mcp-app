import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { App, applyDocumentTheme } from "@modelcontextprotocol/ext-apps";
import { CheckCircle2, CircleAlert, Clock3, ExternalLink, Layers3, LoaderCircle, MessageCircle, RefreshCw, Search, X } from "lucide-react";
import jenkinsHeadshot from "../../assets/jenkins-headshot.png";
import { InlineCard } from "./inline.jsx";
import { createAutoExpandController } from "./display-mode.js";
import "./style.css";

const mode = document.body.dataset.mode;
const bridge = new App({ name: "jenkins-plugin-ui", version: document.body.dataset.uiVersion }, {
  availableDisplayModes: mode === "workspace" ? ["fullscreen"] : ["inline", "fullscreen"],
});
document.body.dataset.documentId = crypto.randomUUID();
const systemTheme = window.matchMedia("(prefers-color-scheme: dark)");
let hasHostTheme = false;
applyDocumentTheme(systemTheme.matches ? "dark" : "light");
systemTheme.addEventListener("change", (event) => {
  if (!hasHostTheme) applyDocumentTheme(event.matches ? "dark" : "light");
});
function applyHostTheme({ theme } = {}) {
  if (theme) {
    hasHostTheme = true;
    applyDocumentTheme(theme);
  }
}

function resultData(result) {
  if (result?.isError) throw new Error(result.content?.find((item) => item.type === "text")?.text || "Jenkins 请求失败");
  if (result?.structuredContent) return result.structuredContent;
  const text = result?.content?.find((item) => item.type === "text")?.text;
  if (!text) return {};
  try { return JSON.parse(text); } catch { throw new Error("Jenkins 返回的数据格式无法识别"); }
}

async function call(name, args = {}) {
  return resultData(await bridge.callServerTool({ name, arguments: args }));
}

function jobsFrom(value) {
  const rows = Array.isArray(value) ? value : value?.jobs ?? value?.items ?? [];
  return rows.filter((job) => job && typeof job === "object").map((job) => ({
    name: job.fullName || job.name || "未命名任务",
    url: job.url,
    folder: Boolean(job.jobs || /(?:Folder|MultiBranchProject)/.test(String(job._class || ""))),
    build: job.lastBuild || job.lastCompletedBuild || null,
    color: job.color,
  }));
}

function buildStatus(build, color) {
  if (build?.building || String(color).endsWith("_anime")) return "运行中";
  const result = String(build?.result || "").toUpperCase();
  if (result === "SUCCESS") return "成功";
  if (result === "FAILURE") return "失败";
  if (result === "UNSTABLE") return "不稳定";
  if (result === "ABORTED") return "已中止";
  if (result === "NOT_BUILT") return "未构建";
  if (color === "blue") return "成功";
  if (color === "red") return "失败";
  if (color === "yellow") return "不稳定";
  return "暂无结果";
}

function Status({ build, color }) {
  const value = buildStatus(build, color);
  const abnormal = ["失败", "不稳定", "已中止"].includes(value);
  const Icon = value === "成功" ? CheckCircle2 : value === "运行中" ? LoaderCircle : abnormal ? CircleAlert : Clock3;
  return <span className={`status ${value === "成功" ? "ok" : abnormal ? "bad" : "idle"}`}><Icon size={16} />{value}</span>;
}

function formatTime(timestamp) {
  if (!Number.isFinite(timestamp) || timestamp <= 0) return "—";
  return new Intl.DateTimeFormat("zh-CN", { dateStyle: "short", timeStyle: "short" }).format(timestamp);
}

function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms < 0) return "—";
  const seconds = Math.round(ms / 1000);
  return `${Math.floor(seconds / 60)} 分 ${String(seconds % 60).padStart(2, "0")} 秒`;
}

function ParameterDetails({ parameters, gitChoices, readGitChoices }) {
  if (!parameters) return <p>正在读取参数…</p>;
  if (!(parameters.parameters ?? []).length) return <p>{parameters.unavailable ? /HTTP 403/.test(parameters.error || "") ? "无权限读取参数定义" : `参数读取失败：${parameters.error || "请求失败"}` : "没有已声明的参数。"}</p>;
  return <ul className="parameter-list">{parameters.parameters.map((parameter) => <li key={parameter.name}>
    <strong>{parameter.name}</strong><small>{{git:"Git 候选",choice:"选项",string:"文本",boolean:"开关",password:"敏感",unknown:"其他"}[parameter.type] || "其他"}{parameter.description ? ` · ${parameter.description}` : ""}</small>
    {!parameter.sensitive && <span>默认值：{parameter.defaultValue === null || parameter.defaultValue === undefined ? "未设置" : parameter.defaultValue === "" ? "空字符串" : String(parameter.defaultValue)}</span>}
    {parameter.sensitive ? <span>敏感参数已隐藏</span> : parameter.type === "git" ? <>
      <button type="button" disabled={gitChoices[parameter.name]?.loading} onClick={() => readGitChoices(parameter.name)}>{gitChoices[parameter.name]?.loading ? "正在读取…" : "读取分支候选"}</button>
      {gitChoices[parameter.name]?.choices?.map((choice) => <span key={`${choice.name}-${choice.value}`}>{choice.name || choice.value}</span>)}
      {gitChoices[parameter.name]?.truncated && <span>仅显示前 200 个候选</span>}
      {gitChoices[parameter.name]?.errors?.map((message, index) => <span className="parameter-error" key={index}>{message}</span>)}
    </> : parameter.type === "choice" ? <span>{(parameter.choices ?? []).join("、") || "无选项"}</span> : parameter.defaultValue !== null && parameter.defaultValue !== undefined ? <span>{String(parameter.defaultValue)}</span> : <span>无默认值</span>}
  </li>)}</ul>;
}

function jobErrorMessage(cause) {
  const message = cause?.message || "Jenkins 请求失败";
  if (/fetch failed/i.test(message)) return "连接 Jenkins 时网络请求失败，请重试读取。";
  if (/Jenkins network request failed/i.test(message)) return `连接 Jenkins 时网络请求失败${message.match(/\([A-Z_]+\)/)?.[0] || ""}，请重试读取。`;
  if (/Jenkins request timed out/i.test(message)) return "读取 Jenkins 超时，请重试读取。";
  if (/\b403\b|forbidden|无权限/i.test(message)) return "无权限读取该任务或构建。";
  if (/\b404\b|not found|不存在/i.test(message)) return "该任务或构建不存在。";
  return message;
}

function Root() {
  const [ready, setReady] = useState(false);
  const [hostContext, setHostContext] = useState(null);
  const [error, setError] = useState("");
  const [jobsError, setJobsError] = useState("");
  const [input, setInput] = useState({});
  const [initial, setInitial] = useState(null);
  const [jobs, setJobs] = useState([]);
  const [selected, setSelected] = useState(null);
  const [build, setBuild] = useState(null);
  const [log, setLog] = useState(null);
  const [tab, setTab] = useState("概览");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("全部");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [parameters, setParameters] = useState(null);
  const [gitChoices, setGitChoices] = useState({});
  const [stages, setStages] = useState(undefined);
  const [buildNumberInput, setBuildNumberInput] = useState("");
  const [buildLoading, setBuildLoading] = useState(false);
  const [noBuild, setNoBuild] = useState(false);
  const detailRequestRef = React.useRef(0);
  const jobsRequestRef = React.useRef(0);
  const expandRef = React.useRef(null);
  if (!expandRef.current) expandRef.current = createAutoExpandController(bridge, (state) => {
    document.body.dataset.autoExpandState = state.status;
    if (state.fromMode) document.body.dataset.autoExpandFrom = state.fromMode;
    if (state.reason) document.body.dataset.autoExpandReason = state.reason;
    if (state.mode) document.body.dataset.displayMode = state.mode;
    if (["requesting", "expanded", "already-fullscreen", "unsupported", "not-applied", "failed"].includes(state.status)) {
      bridge.sendLog({ level: "info", logger: "jenkins-display-mode", data: state }).catch(() => {});
    }
  });

  useEffect(() => {
    bridge.onhostcontextchanged = () => {
      const context = bridge.getHostContext();
      applyHostTheme(context);
      setHostContext(context);
      if (context?.displayMode && !document.body.dataset.initialDisplayMode) document.body.dataset.initialDisplayMode = context.displayMode;
      if (context?.displayMode) document.body.dataset.displayMode = context.displayMode;
    };
    bridge.ontoolinput = (value) => setInput(value.arguments || {});
    bridge.ontoolresult = (value) => {
      try { setInitial(resultData(value)); } catch (cause) { setError(cause.message); }
    };
    bridge.connect().then(() => {
      const context = bridge.getHostContext();
      applyHostTheme(context);
      setHostContext(context);
      if (context?.displayMode && !document.body.dataset.initialDisplayMode) document.body.dataset.initialDisplayMode = context.displayMode;
      if (context?.displayMode) document.body.dataset.displayMode = context.displayMode;
      setReady(true);
    }).catch((cause) => setError(cause.message || "无法连接宿主"));
  }, []);

  useEffect(() => {
    if (mode !== "card") return;
    // Queue cards also work with older server connections that omit autoExpand.
    const requested = input.autoExpand ?? initial?.autoExpand ?? Number.isInteger(input.queueId ?? initial?.queueId);
    expandRef.current.update({ ready, requested, context: hostContext });
  }, [ready, hostContext, input.autoExpand, input.queueId, initial?.autoExpand, initial?.queueId]);

  async function refresh() {
    const requestId = ++jobsRequestRef.current;
    setBusy(true); setJobsError("");
    try {
      const result = await call("uiListJobs");
      if (requestId === jobsRequestRef.current) setJobs(jobsFrom(result));
    } catch (cause) { if (requestId === jobsRequestRef.current) setJobsError(jobErrorMessage(cause)); }
    finally { if (requestId === jobsRequestRef.current) setBusy(false); }
  }

  async function openBuild(jobFullName, buildNumber) {
    const requestId = ++detailRequestRef.current;
    setSelected(jobFullName); setBuild(null); setLog(null); setParameters(null); setGitChoices({}); setStages(undefined); setTab("概览"); setError(""); setBuildLoading(true); setNoBuild(false);
    call("uiGetJobParameters", { jobFullName }).then((value) => { if (requestId === detailRequestRef.current) setParameters(value); }).catch((cause) => { if (requestId === detailRequestRef.current) setParameters({ parameters: [], unavailable: true, error: cause.message }); });
    try {
      let requestedBuild = buildNumber;
      if (!requestedBuild) {
        const job = await call("uiGetJob", { jobFullName });
        if (requestId !== detailRequestRef.current) return;
        requestedBuild = job.lastBuild?.number;
        if (!requestedBuild) { setNoBuild(true); setBuildLoading(false); return; }
      }
      const next = await call("uiGetBuild", { jobFullName, buildNumber: Number(requestedBuild) });
      if (requestId !== detailRequestRef.current) return;
      setBuild(next); setBuildNumberInput(String(next.number ?? ""));
      setBuildLoading(false);
      call("uiGetBuildStages", { jobFullName, buildNumber: next.number }).then((value) => { if (requestId === detailRequestRef.current) setStages(value); }).catch((cause) => { if (requestId === detailRequestRef.current) setStages({ available: false, reason: "request_failed", message: cause.message }); });
    }
    catch (cause) { if (requestId === detailRequestRef.current) { setError(jobErrorMessage(cause)); setBuildLoading(false); } }
  }

  async function readBuildNumber(event) {
    event.preventDefault();
    const number = Number(buildNumberInput);
    if (!selected || !Number.isInteger(number) || number <= 0) return;
    await openBuild(selected, number);
  }

  async function readGitChoices(parameterName) {
    const key = parameterName;
    const jobFullName = selected;
    const requestId = detailRequestRef.current;
    if (!jobFullName) return;
    setGitChoices((current) => ({ ...current, [key]: { loading: true } }));
    try {
      const result = await call("uiGetGitParameterChoices", { jobFullName, parameterName });
      if (requestId === detailRequestRef.current) setGitChoices((current) => ({ ...current, [key]: { choices: result.choices ?? [], errors: result.errors ?? [], truncated: result.truncated === true } }));
    } catch (cause) { if (requestId === detailRequestRef.current) setGitChoices((current) => ({ ...current, [key]: { errors: [cause.message] } })); }
  }

  async function openFolder(jobFullName) {
    const requestId = ++jobsRequestRef.current;
    setBusy(true); setJobsError("");
    try { const result = await call("uiGetJob", { jobFullName }); if (requestId === jobsRequestRef.current) setJobs(jobsFrom(result)); }
    catch (cause) { if (requestId === jobsRequestRef.current) setJobsError(jobErrorMessage(cause)); }
    finally { if (requestId === jobsRequestRef.current) setBusy(false); }
  }

  async function showLog() {
    if (!selected) return;
    const requestId = detailRequestRef.current;
    const jobFullName = selected;
    const buildNumber = build?.number;
    setTab("日志");
    if (log !== null) return;
    try { const result = await call("uiGetBuildLog", { jobFullName, ...(buildNumber ? { buildNumber } : {}) }); if (requestId === detailRequestRef.current) setLog(result.log ?? "无日志"); }
    catch (cause) { if (requestId === detailRequestRef.current) { setLog("日志读取失败"); setError(cause.message); } }
  }

  async function ask() {
    if (!selected) return;
    try {
      const failed = ["失败", "不稳定", "已中止"].includes(buildStatus(build));
      const result = await bridge.sendMessage({ role: "user", content: [{ type: "text", text: `请分析 Jenkins 任务 ${selected} 的构建 #${build?.number || "最近一次"}，${failed ? "说明失败原因和下一步" : "概述构建结果和下一步"}。` }] });
      if (result?.isError) throw new Error("宿主未接受这条提问");
      setNotice("已发送到当前对话");
    } catch (cause) { setError(cause.message); }
  }

  async function openJenkins() {
    if (!build?.url) return;
    try {
      const result = await bridge.openLink({ url: build.url });
      if (result?.isError) throw new Error("宿主未打开链接");
    } catch (cause) { setError(cause.message); }
  }

  useEffect(() => {
    if (!ready) return;
    if (mode !== "card") refresh();
  }, [ready]);

  useEffect(() => {
    if (!ready || mode !== "panel") return;
    const name = input.jobFullName || initial?.jobFullName;
    const number = input.buildNumber || initial?.build?.number;
    if (name) openBuild(name, number);
  }, [ready, input.jobFullName, input.buildNumber, initial?.jobFullName, initial?.build?.number]);

  useEffect(() => {
    if (mode !== "panel" || selected || !jobs.length) return;
    const first = jobs.find((job) => !job.folder);
    if (first) openBuild(first.name, first.build?.number);
  }, [jobs, selected]);

  const visible = useMemo(() => jobs.filter((job) => job.name.toLowerCase().includes(query.toLowerCase()) && (filter === "全部" || buildStatus(job.build, job.color) === filter)), [jobs, query, filter]);
  if (mode === "card") return <InlineCard ready={ready} initial={initial} input={input} hostError={error} call={call} bridge={bridge} />;

  const detail = <section className="detail" aria-label="构建详情">
    <header className="detail-header"><img src={jenkinsHeadshot} alt="" /><strong>Jenkins</strong></header>
    {!selected && <div className="empty">请选择一个任务查看构建。</div>}
    {selected && <><div className="detail-title"><small>构建检查</small><h2>{selected}</h2>{build && <p>#{build.number} · {formatTime(build.timestamp)}</p>}</div>
      {build ? <><div className={`outcome ${buildStatus(build) === "成功" ? "ok" : ["失败", "不稳定", "已中止"].includes(buildStatus(build)) ? "bad" : "idle"}`}><Status build={build} /><span>{formatDuration(build.duration)}</span></div><div className="tabs"><button className={tab === "概览" ? "active" : ""} onClick={() => setTab("概览")}>概览</button><button className={tab === "日志" ? "active" : ""} onClick={showLog}>日志</button></div><div className="detail-body">{tab === "概览" ? <><form className="build-picker" onSubmit={readBuildNumber}><label>构建编号<input aria-label="构建编号" type="number" min="1" step="1" required inputMode="numeric" value={buildNumberInput} onChange={(event) => setBuildNumberInput(event.target.value)} /></label><button type="submit">读取</button></form><dl><div><dt>结果</dt><dd>{buildStatus(build)}</dd></div><div><dt>开始时间</dt><dd>{formatTime(build.timestamp)}</dd></div><div><dt>耗时</dt><dd>{formatDuration(build.duration)}</dd></div></dl><section className="detail-section"><h3>Pipeline 阶段</h3>{stages === undefined ? <p>正在读取阶段…</p> : stages.available === false ? <p>{stages.reason === "request_failed" ? `阶段读取失败：${stages.message || "请求失败"}` : ["permission-denied", "permission_denied"].includes(stages.reason) ? "无权限读取阶段" : ["not_found", "unsupported"].includes(stages.reason) ? "此构建没有可用的 Pipeline 阶段信息" : "阶段信息暂不可用"}</p> : stages.stages?.length ? <ul className="stage-list">{stages.stages.map((stage, index) => <li key={`${stage.name}-${index}`}><span>{stage.name}</span><span>{stage.status === "SUCCESS" ? "已完成" : stage.status === "FAILED" ? "失败" : stage.status === "ABORTED" ? "已中止" : stage.status === "UNSTABLE" ? "不稳定" : stage.status === "PAUSED_PENDING_INPUT" ? "等待审批输入" : stage.status === "NOT_EXECUTED" ? build.building ? "待执行" : "已跳过" : stage.status === "IN_PROGRESS" ? "运行中" : stage.status}</span></li>)}</ul> : <p>Jenkins 未返回阶段信息</p>}</section><section className="detail-section"><h3>任务参数（只读）</h3><ParameterDetails parameters={parameters} gitChoices={gitChoices} readGitChoices={readGitChoices} /></section></> : <pre className="log">{log === null ? "正在读取日志…" : log}</pre>}</div><footer><button onClick={ask}><MessageCircle size={16} />询问 ChatGPT</button><button onClick={openJenkins} disabled={!build.url}><ExternalLink size={16} />打开 Jenkins</button></footer></> : <><div className="loading">{buildLoading ? "正在读取构建…" : noBuild ? "该任务尚无构建记录。" : error || "构建不可用"}</div><div className="detail-body"><section className="detail-section"><h3>任务参数（只读）</h3><ParameterDetails parameters={parameters} gitChoices={gitChoices} readGitChoices={readGitChoices} /></section></div></>}
    </>}
  </section>;

  const listError = jobsError && <div className="alert" role="alert">任务列表读取失败：{jobsError}<button type="button" onClick={refresh} disabled={busy}>重试任务列表</button></div>;
  if (mode === "panel") return <main className="panel-shell">{error && <div className="alert" role="alert">构建操作失败：{error}</div>}{listError}{notice && <div className="notice" role="status">{notice}</div>}{mode === "panel" && jobs.length > 0 && <div className="panel-select"><label>选择任务<select value={selected || ""} onChange={(event) => openBuild(event.target.value)}><option value="">请选择</option>{jobs.filter((job) => !job.folder).map((job) => <option key={job.name} value={job.name}>{job.name}</option>)}</select></label></div>}{detail}</main>;

  return <main className="workspace-shell">
    <nav className="workspace-nav"><div className="brand"><img src={jenkinsHeadshot} alt="" /><strong>Jenkins</strong></div><span className="nav-item active"><Layers3 size={18} />构建工作台</span><small>数据来自当前 Jenkins 连接</small></nav>
    <section className="workspace-main"><header className="workspace-heading"><div><h1>构建概览</h1><p>查看任务和最近构建</p></div><button aria-label="刷新任务" onClick={refresh} disabled={busy}><RefreshCw size={18} /></button></header>
      {error && <div className="alert" role="alert">构建操作失败：{error}</div>}{listError}{notice && <div className="notice" role="status">{notice}</div>}
      <div className="summary"><div><small>可见任务</small><strong>{jobs.length}</strong></div><div><small>失败构建</small><strong>{jobs.filter((job) => buildStatus(job.build, job.color) === "失败").length}</strong></div><div><small>运行中</small><strong>{jobs.filter((job) => buildStatus(job.build, job.color) === "运行中").length}</strong></div></div>
      <div className="list-heading"><h2>任务</h2><div className="controls"><label><Search size={16} /><input aria-label="搜索任务" placeholder="搜索任务" value={query} onChange={(event) => setQuery(event.target.value)} /></label><select aria-label="按状态筛选" value={filter} onChange={(event) => setFilter(event.target.value)}><option>全部</option><option>失败</option><option>成功</option><option>运行中</option></select></div></div>
      {busy && <div className="loading">正在读取任务…</div>}
      {!busy && visible.length === 0 && <div className="empty">{jobs.length ? "没有符合条件的任务" : "暂无可见任务"}</div>}
      <div className="job-list">{visible.map((job) => <button key={job.name} className={selected === job.name ? "selected" : ""} onClick={() => job.folder ? openFolder(job.name) : openBuild(job.name, job.build?.number)}><span className="job-name"><Layers3 size={17} />{job.name}</span>{job.folder ? <span>文件夹</span> : <><span>#{job.build?.number ?? "—"}</span><Status build={job.build} color={job.color} /></>}</button>)}</div>
    </section>{detail}
  </main>;
}

createRoot(document.getElementById("root")).render(<Root />);
