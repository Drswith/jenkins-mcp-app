import React, { useEffect, useState } from "react";
import { StatusIcon, buildStatus, statusLabel } from "./status.jsx";
import { promptTarget, sendPrompt } from "./host.js";

export function Workspace({ ready, call, bridge, hostError, hostContext }) {
  const [jobs, setJobs] = useState(null);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState("");
  const [notice, setNotice] = useState("");
  const target = promptTarget(bridge, true);
  useEffect(() => {
    if (!ready) return;
    let disposed = false;
    call("uiGetWatchedJobs").then((value) => { if (!disposed) setJobs(value.jobs); }).catch((cause) => { if (!disposed) setError(cause.message); });
    return () => { disposed = true; };
  }, [ready, call]);
  async function act(job) {
    setError("");
    try {
      if (["FAILURE", "UNSTABLE"].includes(job.build?.result) && !job.build?.building) {
        const text = `请排查 Jenkins 任务 ${JSON.stringify(job.jobFullName)} 的构建 #${job.build.number}，读取阶段、日志和变更后说明证据与下一步。`;
        setDraft(text);
        const sentTarget = await sendPrompt(bridge, text, true);
        setDraft(""); setNotice(sentTarget === "new" ? "已发送到新对话" : "已发送到当前对话");
      } else {
        const result = await bridge.openLink({url: job.build?.url || job.url});
        if (result?.isError) throw new Error("宿主未打开链接");
      }
    } catch (cause) { setError(cause.message); }
  }
  return <main className="workspace"><h1>关注</h1><p className="subtle">设置中的任务 · 打开时读取一次 · 最多 8 项</p>
    {(hostError || error) && <p role="alert" className="inline-error">{hostError || error}</p>}
    {notice && <p role="status">{notice}</p>}
    {!jobs ? <p>{ready ? "正在读取关注任务…" : "正在连接宿主…"}</p> : jobs.length === 0 ? <p>尚未关注任务。请在插件设置中填写“关注的任务”；若宿主未提供设置界面，可按配置文档编辑本地显示设置文件。</p> : <div className="watch-list">{jobs.slice(0,8).map((job) => <article key={job.jobFullName}>
      <h2><StatusIcon status={buildStatus(job.build)} /><span>{job.jobFullName}</span></h2>
      <p>{job.error || (job.build ? `#${job.build.number} · ${statusLabel(buildStatus(job.build))}` : "暂无构建记录")}</p>
      <button className={["FAILURE", "UNSTABLE"].includes(job.build?.result) && !job.build?.building ? "primary" : "secondary"} disabled={!job.build && !job.url} onClick={() => act(job)}>{["FAILURE", "UNSTABLE"].includes(job.build?.result) && !job.build?.building ? target === "new" ? "在新对话中排查" : "在当前对话中排查" : "在 Jenkins 打开"}</button>
    </article>)}</div>}
    {draft && <textarea aria-label="待发送的排查请求" readOnly value={draft} />}
  </main>;
}
