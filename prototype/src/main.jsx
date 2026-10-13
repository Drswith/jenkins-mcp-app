import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Activity, ArrowRight, Check, CheckCircle2, ChevronDown,
  ChevronRight, CircleAlert, Clock3, Copy, ExternalLink,
  GitCommitHorizontal, Home, Inbox, Layers3, ListFilter, LoaderCircle,
  MessageCircle, Play, RefreshCw, Search, Settings2, ShieldCheck,
  TestTube2, X,
} from "lucide-react";
import jenkinsHeadshot from "../../assets/jenkins-headshot.png";
import "./style.css";

const labels = {
  Workspace: "工作台", "Thread panel": "对话侧边栏", "Inline card": "对话内卡片",
  Overview: "概览", Jobs: "任务", Queue: "队列", "Recent builds": "最近构建", Settings: "设置",
  Success: "成功", Failed: "失败", Running: "运行中", Queued: "排队中",
  Summary: "摘要", Console: "控制台", Tests: "测试", Changes: "变更", Log: "日志",
};

const builds = [
  { job: "platform / checkout-api", number: 284, status: "Failed", duration: "4 分 12 秒", started: "10 分钟前", branch: "main", cause: "alexr 推送", commit: "9f3c2ab", tests: "312 通过 · 1 失败", error: "预发布环境部署时就绪探针失败。" },
  { job: "platform / user-service", number: 512, status: "Success", duration: "2 分 48 秒", started: "22 分钟前", branch: "main", cause: "maya 推送", commit: "48bd019", tests: "186 通过", error: "" },
  { job: "platform / catalog-service", number: 367, status: "Success", duration: "3 分 21 秒", started: "31 分钟前", branch: "main", cause: "sam 推送", commit: "b10de52", tests: "224 通过", error: "" },
  { job: "web / frontend", number: 901, status: "Success", duration: "5 分 35 秒", started: "46 分钟前", branch: "main", cause: "alexr 推送", commit: "a5418ef", tests: "128 通过", error: "" },
  { job: "web / e2e-tests", number: 218, status: "Failed", duration: "6 分 02 秒", started: "1 小时前", branch: "release/2.4", cause: "定时触发", commit: "0f8bc46", tests: "41 通过 · 2 失败", error: "结账流程等待确认时超时。" },
  { job: "infra / terraform", number: 140, status: "Success", duration: "4 分 55 秒", started: "1 小时前", branch: "main", cause: "riley 推送", commit: "19ba01c", tests: "校验通过", error: "" },
  { job: "infra / k8s-deploy", number: 301, status: "Running", duration: "12 分 16 秒", started: "12 分钟前", branch: "main", cause: "操作员启动", commit: "71c062a", tests: "待执行", error: "" },
  { job: "data / nightly-etl", number: 77, status: "Queued", duration: "—", started: "3 分钟前", branch: "main", cause: "定时触发", commit: "e93a2d1", tests: "待执行", error: "" },
  { job: "libs / shared", number: 645, status: "Success", duration: "1 分 49 秒", started: "2 小时前", branch: "main", cause: "maya 推送", commit: "f801abc", tests: "94 通过", error: "" },
  { job: "mobile / ios", number: 190, status: "Success", duration: "7 分 33 秒", started: "2 小时前", branch: "main", cause: "jordan 推送", commit: "e66202e", tests: "76 通过", error: "" },
];

const queue = [
  { job: "data / nightly-etl", number: 77, position: "Waiting", reason: "等待可用的执行节点", time: "3 分钟" },
  { job: "infra / k8s-deploy", number: 301, position: "Running", reason: "部署阶段 · 第 3/4 步", time: "12 分钟" },
];

const consoleLines = [
  ["104", "[INFO] Resolving dependencies...", ""],
  ["105", "[INFO] Tests passed (312)", ""],
  ["106", "[INFO] Building Docker image...", ""],
  ["107", "[INFO] Pushing image to registry...", ""],
  ["108", "[INFO] Deploying to staging...", ""],
  ["109", "[INFO] Waiting for readiness probe", ""],
  ["110", "[ERROR] Readiness probe failed", "error"],
  ["111", "[ERROR] pod checkout-api-7d6f9c6b7-2k8gm not ready", "error"],
  ["112", "[INFO] Cleaning up deployment...", ""],
  ["113", "[INFO] Build step 'Deploy' marked as failure", ""],
  ["114", "Finished: FAILURE", "error"],
];

const navItems = [
  { label: "Overview", icon: Home },
  { label: "Jobs", icon: Layers3 },
  { label: "Queue", icon: Inbox },
  { label: "Recent builds", icon: Activity },
  { label: "Settings", icon: Settings2 },
];

function Status({ value, small = false }) {
  const Icon = value === "Success" ? CheckCircle2 : value === "Failed" ? CircleAlert : value === "Running" ? LoaderCircle : Clock3;
  return <span className={`status status-${value.toLowerCase()} ${small ? "status-small" : ""}`}><Icon size={small ? 14 : 16} strokeWidth={2.2} className={value === "Running" ? "spin" : ""} />{labels[value]}</span>;
}

function App() {
  const [mode, setMode] = useState("Workspace");
  const [section, setSection] = useState("Overview");
  const [selected, setSelected] = useState(builds[0]);
  const [inspectorTab, setInspectorTab] = useState("Summary");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("All jobs");
  const [modal, setModal] = useState(false);
  const [toast, setToast] = useState("");
  const [draft, setDraft] = useState("");
  const [refreshCount, setRefreshCount] = useState(0);

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(""), 3500);
    return () => clearTimeout(id);
  }, [toast]);

  useEffect(() => {
    if (mode !== "Thread panel") setDraft("");
  }, [mode]);

  const filteredBuilds = useMemo(() => builds.filter((build) => {
    const matchesSearch = build.job.toLowerCase().includes(search.toLowerCase());
    const matchesFilter = filter === "All jobs" || build.status === filter;
    return matchesSearch && matchesFilter;
  }), [search, filter]);

  function inspect(build) {
    setSelected(build);
    setInspectorTab("Summary");
  }

  function askAboutBuild() {
    setMode("Thread panel");
    setDraft(selected.status === "Failed" ? `${selected.job} 的构建 #${selected.number} 为什么失败？` : `${selected.job} 的构建 #${selected.number} 为什么得到这个结果？`);
  }

  const actions = { setMode, setSection, setSelected: inspect, setInspectorTab, setToast, setModal, askAboutBuild };

  return <div className="prototype-shell">
    <header className="prototype-bar">
      <div className="prototype-identity"><img src={jenkinsHeadshot} alt="" /><div><strong>Jenkins for ChatGPT</strong><span>{"交互位置原型"}</span></div></div>
      <div className="placement-switch" role="tablist" aria-label={"界面展示位置预览"}>
        {["Workspace", "Thread panel", "Inline card"].map((item) => <button key={item} role="tab" aria-selected={mode === item} className={mode === item ? "active" : ""} onClick={() => setMode(item)}>{labels[item]}</button>)}
      </div>
      <span className="demo-label"><span className="demo-dot" />演示数据</span>
    </header>

    <div className="mode-note">
      {mode === "Workspace" ? "全局侧栏应用 · 全屏工作台" : mode === "Thread panel" ? "对话侧边栏 · 桌面 360px / 窄屏展开" : "对话结果 · 精简内联卡片"}
      <span>{"仅供界面体验 · 未连接 Jenkins"}</span>
    </div>

    {mode === "Workspace" ? <Workspace section={section} selected={selected} search={search} filter={filter} filteredBuilds={filteredBuilds} refreshCount={refreshCount} setSearch={setSearch} setFilter={setFilter} setRefreshCount={setRefreshCount} {...actions} /> :
      <Conversation mode={mode} selected={selected} draft={draft} {...actions} />}

    {modal && <RunBuildModal selected={selected} close={() => setModal(false)} confirm={() => { setModal(false); setToast(`仅为演示：${selected.job} 将进入队列；未向 Jenkins 发送请求。`); }} />}
    {toast && <div className="toast" role="status"><Check size={16} />{toast}<button onClick={() => setToast("")} aria-label={"关闭通知"}><X size={14} /></button></div>}
  </div>;
}

function Workspace({ section, selected, search, filter, filteredBuilds, refreshCount, setSearch, setFilter, setRefreshCount, setSection, setSelected, setInspectorTab, setMode, setToast, setModal, askAboutBuild }) {
  return <div className="workspace">
    <aside className="workspace-nav">
      <div className="nav-brand"><img src={jenkinsHeadshot} alt="" /><span>Jenkins</span></div>
      <nav aria-label={"Jenkins 工作台"}>
        {navItems.map(({ label, icon: Icon }) => <button key={label} className={`nav-item ${section === label ? "selected" : ""}`} onClick={() => setSection(label)}><Icon size={18} strokeWidth={1.9} />{labels[label]}</button>)}
      </nav>
      <div className="nav-bottom"><span className="connection-dot demo" />{"示例数据"} <small>jenkins.example.com<br />{"未连接 Jenkins"}</small></div>
    </aside>

    <main className="workspace-main">
      {section === "Settings" ? <SettingsPage setToast={setToast} /> : <>
        <div className="page-header">
          <div><h1>{section === "Overview" ? "构建概览" : labels[section]}</h1><p><span className="connection-dot demo" />{"示例控制器 · jenkins.example.com"}</p></div>
          <div className="header-actions"><span>{"刚刚更新"}{refreshCount ? ` · 已刷新 ${refreshCount} 次` : ""}</span><button className="icon-button" title={"刷新演示数据"} aria-label={"刷新演示数据"} onClick={() => { setRefreshCount(refreshCount + 1); setToast("已刷新示例数据。"); }}><RefreshCw size={18} /></button></div>
        </div>
        {section === "Overview" && <SummaryStrip />}
        {section === "Queue" ? <QueueList setSelected={setSelected} setSection={setSection} /> : <>
          <div className="section-heading"><h2>{section === "Overview" ? "最近任务" : section === "Recent builds" ? "最新构建结果" : "全部任务"}</h2><div className="table-controls"><div className="search-field"><Search size={17} /><input aria-label={"搜索任务"} placeholder={"搜索任务…"} value={search} onChange={(event) => setSearch(event.target.value)} /></div><div className="select-wrap"><ListFilter size={16} /><select aria-label={"按状态筛选任务"} value={filter} onChange={(event) => setFilter(event.target.value)}><option value="All jobs">{"全部任务"}</option><option value="Failed">{"失败"}</option><option value="Success">{"成功"}</option><option value="Running">{"运行中"}</option><option value="Queued">{"排队中"}</option></select><ChevronDown size={15} /></div></div></div>
          <BuildTable builds={filteredBuilds} selected={selected} setSelected={setSelected} setModal={setModal} />
        </>}
      </>}
    </main>

    {section !== "Settings" && <Inspector build={selected} tab={null} setTab={setInspectorTab} compact={false} askAboutBuild={askAboutBuild} setMode={setMode} setToast={setToast} setModal={setModal} />}
  </div>;
}

function SummaryStrip() {
  const stats = [
    { label: "任务总数", value: "28", hint: "分布在 4 个目录", icon: Layers3, tone: "neutral" },
    { label: "失败构建", value: "3", hint: "最近 24 小时", icon: CircleAlert, tone: "red" },
    { label: "队列", value: "2", hint: "1 个等待中 · 1 个运行中", icon: Clock3, tone: "blue" },
    { label: "成功率", value: "89%", hint: "最近 50 次构建", icon: CheckCircle2, tone: "green" },
  ];
  return <div className="summary-strip">{stats.map(({ label, value, hint, icon: Icon, tone }) => <div className="stat" key={label}><div className="stat-label"><Icon size={17} className={`tone-${tone}`} />{label}</div><strong>{value}</strong><span>{hint}</span></div>)}</div>;
}

function BuildTable({ builds: rows, selected, setSelected, setModal }) {
  return <div className="table-region"><table className="jobs-table"><thead><tr><th>{"任务"}</th><th>{"最近构建"}</th><th>{"状态"}</th><th>{"耗时"}</th><th>{"开始时间"}</th><th><span className="sr-only">{"操作"}</span></th></tr></thead><tbody>{rows.map((build) => <tr key={build.job} className={selected.job === build.job ? "is-selected" : ""} onClick={() => setSelected(build)} tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter") setSelected(build); }}><td><span className="job-cell"><Layers3 size={16} />{build.job}</span></td><td className="build-link">#{build.number}</td><td><Status value={build.status} small /></td><td>{build.duration}</td><td>{build.started}</td><td><button className="row-action" title={`运行 ${build.job}`} aria-label={`运行 ${build.job}`} onClick={(event) => { event.stopPropagation(); setSelected(build); setModal(true); }}><Play size={14} fill="currentColor" /></button></td></tr>)}</tbody></table>{rows.length === 0 && <div className="empty-state"><Search size={22} /><strong>{"未找到任务"}</strong><span>{"请更换搜索词或状态筛选条件。"}</span></div>}</div>;
}

function QueueList({ setSelected, setSection }) {
  return <div className="queue-section"><div className="section-heading"><h2>{"队列与运行中的任务"}</h2><span className="section-count">{"2 项"}</span></div>{queue.map((item) => <button className="queue-row" key={item.job} onClick={() => { setSelected(builds.find((build) => build.job === item.job)); setSection("Jobs"); }}><span className={`queue-symbol ${item.position.toLowerCase()}`}><Clock3 size={18} /></span><span className="queue-copy"><strong>{item.job} <span>#{item.number}</span></strong><small>{item.reason}</small></span><Status value={item.position === "Waiting" ? "Queued" : "Running"} small /><time>{item.time}</time><ChevronRight size={18} /></button>)}</div>;
}

function SettingsPage({ setToast }) {
  return <div className="settings-page"><div className="settings-intro"><ShieldCheck size={24} /><div><h2>{"连接设置"}</h2><p>{"这是界面预览。原型不会存储或发送凭据。"}</p></div></div><div className="settings-grid"><label>{"控制器地址"}<input value="https://jenkins.example.com" readOnly /></label><label>{"身份验证"}<input value={"在原型外配置"} readOnly /></label><label>{"连接方式"}<select defaultValue="Jenkins MCP Server"><option value="Jenkins MCP Server">Jenkins MCP Server</option><option value="Remote API fallback">{"Remote API 备用模式"}</option></select></label></div><div className="settings-footer"><span><span className="connection-dot demo" /> {"当前未连接 Jenkins"}</span><button className="button secondary" onClick={() => setToast("仅为演示：未发起连接测试。")}>{"测试连接"}</button></div></div>;
}

function Inspector({ build, tab, setTab, compact, askAboutBuild, setMode, setToast, setModal }) {
  const [localTab, setLocalTab] = useState("Summary");
  const activeTab = tab ?? localTab;
  const changeTab = (value) => { setLocalTab(value); setTab?.(value); };
  useEffect(() => setLocalTab("Summary"), [build.job]);
  return <aside className={`inspector ${compact ? "inspector-thread" : ""}`} aria-label={"构建检查器"}>
    <div className="inspector-heading"><div className="breadcrumb">{build.job.replace(" / ", "  /  ")}</div>{compact ? <button className="icon-button" aria-label={"关闭检查器"} onClick={() => setMode("Inline card")}><X size={18} /></button> : <button className="icon-button" aria-label={"在对话面板中打开"} title={"在对话中打开"} onClick={() => setMode("Thread panel")}><ArrowRight size={18} /></button>}</div>
    <div className="inspector-build"><div className={`large-status ${build.status.toLowerCase()}`}>{build.status === "Success" ? <Check size={20} /> : build.status === "Failed" ? <X size={20} /> : <Clock3 size={20} />}</div><div><h2>{`构建 #${build.number}`}</h2><span><Status value={build.status} small /> · {build.duration} · {build.started}</span></div></div>
    <div className="inspector-tabs" role="tablist" aria-label={"构建详情"}>{["Summary", "Console", "Tests", "Changes"].map((name) => <button key={name} role="tab" aria-selected={activeTab === name} className={activeTab === name ? "active" : ""} onClick={() => changeTab(name)}>{labels[name]}</button>)}</div>
    <div className="inspector-body">{activeTab === "Summary" ? <SummaryDetail build={build} /> : activeTab === "Console" ? <ConsoleDetail build={build} setToast={setToast} /> : activeTab === "Tests" ? <TestsDetail build={build} /> : <ChangesDetail build={build} />}</div>
    <div className="inspector-actions">{compact ? <button className="button primary" onClick={askAboutBuild}><MessageCircle size={16} />{"询问此构建"}</button> : <button className="button secondary" onClick={askAboutBuild}><MessageCircle size={16} />{"在对话中打开"}</button>}<button className="button secondary" onClick={() => setToast("仅为演示：尚未连接 Jenkins 页面跳转。")}><ExternalLink size={16} />{"在 Jenkins 中查看"}</button>{!compact && <button className="button text" onClick={() => setModal(true)}><Play size={14} />{"运行此任务"}</button>}</div>
  </aside>;
}

function SummaryDetail({ build }) {
  return <><dl className="detail-grid"><div><dt>{"结果"}</dt><dd><Status value={build.status} small /></dd></div><div><dt>{"耗时"}</dt><dd>{build.duration}</dd></div><div><dt>{"开始时间"}</dt><dd>{build.started}</dd></div><div><dt>{"触发来源"}</dt><dd>{build.cause}</dd></div><div><dt>{"分支"}</dt><dd><code>{build.branch}</code></dd></div><div><dt>{"提交"}</dt><dd className="blue-text"><GitCommitHorizontal size={15} />{build.commit}</dd></div></dl><div className="detail-section"><div className="detail-section-heading"><h3>{"控制台输出"}</h3><small>{"最近 11 行"}</small></div><ConsoleBlock build={build} condensed /></div></>;
}

function ConsoleBlock({ build, condensed = false }) {
  const lines = build.status === "Failed" && build.job === builds[0].job ? consoleLines : [["101", "[INFO] Checking out source...", ""], ["102", "[INFO] Running build steps...", ""], ["103", build.status === "Failed" ? `[ERROR] ${build.error}` : `[INFO] ${build.status.toUpperCase()}`, build.status === "Failed" ? "error" : ""]];
  return <div className={`console-block ${condensed ? "condensed" : ""}`}>{lines.map(([line, content, tone]) => <div className={tone} key={`${line}-${content}`}><span>{line}</span><code>{content}</code></div>)}</div>;
}

function ConsoleDetail({ build, setToast }) {
  return <div className="tab-content"><div className="detail-section-heading"><h3>{"控制台日志"}</h3><button className="plain-action" onClick={() => { navigator.clipboard?.writeText(consoleLines.map((line) => line[1]).join("\n")); setToast("已复制示例日志。"); }}><Copy size={14} />{"复制"}</button></div><ConsoleBlock build={build} /></div>;
}

function TestsDetail({ build }) {
  return <div className="tab-content"><div className="test-summary"><TestTube2 size={20} /><div><strong>{"测试结果"}</strong><span>{build.tests}</span></div></div>{build.status === "Failed" && <div className="failed-test"><CircleAlert size={18} /><div><strong>{build.job === builds[0].job ? "预发布环境就绪检查" : "结账确认流程"}</strong><span>{build.error}</span></div></div>}<p className="muted-help">{"测试数据仅用于界面评审。"}</p></div>;
}

function ChangesDetail({ build }) {
  return <div className="tab-content"><div className="change-row"><GitCommitHorizontal size={18} /><div><strong>{build.commit}</strong><span>{build.job === builds[0].job ? "调整结账服务部署配置" : "更新构建输入"}</span><small>{build.cause}</small></div></div><p className="muted-help">{"变更记录仅用于界面评审。"}</p></div>;
}

function Conversation({ mode, selected, draft, setMode, setToast, askAboutBuild }) {
  const isPanel = mode === "Thread panel";
  return <div className={`surface-preview ${isPanel ? "panel-preview" : "inline-preview"}`}>
    <div className="host-area" aria-label="宿主对话位置示意">
      <div className="host-area-heading"><span>对话内容位置示意</span><small>浅灰区域由宿主提供</small></div>
      <div className="host-flow">
        <div className="host-question">{`${selected.job} 的构建 #${selected.number} 是什么情况？`}</div>
        {isPanel ? <>
          <p className="host-answer">{selected.error || `最近一次构建已${labels[selected.status]}。`}右侧可以查看构建日志和测试结果。</p>
          {draft && <div className="prepared-question" role="status"><span>拟在对话中提问</span><strong>{draft}</strong><small>交互原型未向 ChatGPT 发送消息</small></div>}
          <button className="host-inline-link" onClick={() => setMode("Inline card")}>查看内联结果示例 <ArrowRight size={16} /></button>
        </> : <>
          <div className="widget-caption">插件内容 · 内联结果</div>
          <InlineCard build={selected} setMode={setMode} />
          <p className="host-answer after-widget">{selected.status === "Failed" ? "下一步可检查失败步骤的详细日志，再核对执行环境。" : "如需确认影响范围，可继续查看本次变更和测试结果。"}</p>
        </>}
      </div>
    </div>
    {isPanel && <div className="panel-slot"><div className="panel-slot-caption">插件内容 · 对话侧边栏</div><ThreadPanel build={selected} askAboutBuild={askAboutBuild} setMode={setMode} setToast={setToast} /></div>}
  </div>;
}

function ThreadPanel({ build, askAboutBuild, setMode, setToast }) {
  const [section, setSection] = useState("Overview");
  useEffect(() => setSection("Overview"), [build.job]);
  return <aside className="thread-panel" aria-label={"Jenkins 构建面板"}>
    <div className="thread-panel-heading"><div className="thread-panel-brand"><img src={jenkinsHeadshot} alt="" /><span>Jenkins</span></div><button className="icon-button" aria-label={"关闭 Jenkins 面板"} onClick={() => setMode("Inline card")}><X size={18} /></button></div>
    <div className="thread-panel-content">
      <div className="thread-panel-title"><span className="eyebrow">{"构建检查"}</span><h2>{build.job}</h2><div className="thread-panel-meta"><span>#{build.number}</span><span>·</span><span>{build.started}</span></div></div>
      <div className={`thread-outcome ${build.status.toLowerCase()}`}><div className="thread-outcome-top"><Status value={build.status} /><strong>{build.duration}</strong></div><p>{build.error || `最近一次构建状态为${labels[build.status]}。`}</p></div>
      <div className="thread-sections" role="tablist" aria-label={"构建信息"}>{["Overview", "Log", "Tests"].map((name) => <button key={name} role="tab" aria-selected={section === name} className={section === name ? "active" : ""} onClick={() => setSection(name)}>{labels[name]}</button>)}</div>
      {section === "Overview" ? <div className="thread-section-body"><dl className="thread-facts"><div><dt>{"分支"}</dt><dd>{build.branch}</dd></div><div><dt>{"提交"}</dt><dd>{build.commit}</dd></div><div><dt>{"触发来源"}</dt><dd>{build.cause}</dd></div></dl><div className="thread-evidence"><span className="eyebrow">{"下一步"}</span><p>{build.status === "Failed" ? "查看失败日志，或请 ChatGPT 分析这次构建。" : "查看构建日志和测试结果以了解详情。"}</p><button onClick={() => setSection("Log")}>{"查看日志"} <ArrowRight size={15} /></button></div></div> : section === "Log" ? <div className="thread-section-body"><p className="thread-section-intro">{"最近控制台输出 · 示例数据"}</p><ConsoleBlock build={build} /><p className="muted-help">{"完整构建记录可在 Jenkins 中查看。"}</p></div> : <div className="thread-section-body"><TestsDetail build={build} /></div>}
    </div>
    <div className="thread-panel-actions"><button className="button primary" onClick={askAboutBuild}><MessageCircle size={16} />{"询问 ChatGPT"}</button><button className="button secondary" onClick={() => setToast("仅为演示：尚未连接 Jenkins 页面跳转。")}><ExternalLink size={16} />{"打开 Jenkins"}</button></div>
  </aside>;
}

function InlineCard({ build, setMode }) {
  return <div className="inline-card"><div className="inline-card-top"><span className={`inline-indicator ${build.status.toLowerCase()}`}>{build.status === "Success" ? <Check size={15} /> : build.status === "Failed" ? <X size={15} /> : <Clock3 size={15} />}</span><div><small>{`Jenkins 构建 · #${build.number}`}</small><strong>{build.job}</strong></div></div><div className="inline-card-message"><Status value={build.status} small /><span>{build.error || `最近一次结果：${labels[build.status]}。`}</span></div><div className="inline-card-actions"><button className="button secondary" onClick={() => setMode("Thread panel")}>查看详情 <ArrowRight size={15} /></button></div></div>;
}

function RunBuildModal({ selected, close, confirm }) {
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}><div className="modal" role="dialog" aria-modal="true" aria-labelledby="run-title"><div className="modal-icon"><Play size={20} fill="currentColor" /></div><h2 id="run-title">{"运行此任务？"}</h2><p>{"原型只演示确认流程，不会向 Jenkins 发送请求。"}</p><div className="modal-job"><strong>{selected.job}</strong><span>{`最近构建 #${selected.number} · ${labels[selected.status]}`}</span></div><div className="modal-actions"><button className="button secondary" onClick={close}>{"取消"}</button><button className="button primary" onClick={confirm}>{"确认演示操作"}</button></div></div></div>;
}

createRoot(document.getElementById("root")).render(<App />);
