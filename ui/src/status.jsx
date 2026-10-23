import React from "react";

export const statusLabel = (value) => ({ SUCCESS: "成功", FAILURE: "失败", FAILED: "失败", UNSTABLE: "不稳定", ABORTED: "已中止", NOT_BUILT: "未构建", NOT_EXECUTED: "已跳过", DISABLED: "已禁用", IN_PROGRESS: "运行中", QUEUED: "排队中", PAUSED_PENDING_INPUT: "等待输入" }[value] ?? "状态未知");
export const buildStatus = (build) => build?.building ? "IN_PROGRESS" : build?.result;
export function estimatedProgress(elapsed, previousDuration) {
  return Number.isFinite(elapsed) && elapsed >= 0 && Number.isFinite(previousDuration) && previousDuration > 0 ? Math.min(99, elapsed / previousDuration * 100) : null;
}

// Geometry from Jenkins core status-*.svg and pipeline-graph-view StatusIcon (MIT).
export function StatusIcon({ status, elapsed, previousDuration, label = statusLabel(status) }) {
  const running = status === "IN_PROGRESS";
  const tone = status === "SUCCESS" ? "success" : ["FAILURE", "FAILED"].includes(status) ? "danger" : status === "UNSTABLE" ? "warning" : ["IN_PROGRESS", "QUEUED", "PAUSED_PENDING_INPUT"].includes(status) ? "info" : "secondary";
  const radius = running ? (512 - 50) / 2.2 : 250;
  const circumference = 2 * Math.PI * radius;
  const progress = estimatedProgress(elapsed, previousDuration);
  return <svg className={`status-icon tone-${tone}`} viewBox="0 0 512 512" role="img" aria-label={label}>
    <circle cx="256" cy="256" r={radius - 20} fill="var(--surface)" />
    <circle cx="256" cy="256" r={radius} fill="currentColor" opacity="var(--status-background-opacity)" />
    <circle cx="256" cy="256" r={radius - 10} fill="none" stroke="currentColor" strokeWidth="20" strokeOpacity="var(--status-border-opacity)" />
    {running && <><circle cx="256" cy="256" r="40" fill="currentColor" />{progress !== null && <circle cx="256" cy="256" r={radius} fill="none" stroke="currentColor" strokeWidth="50" strokeLinecap="round" strokeDasharray={circumference} strokeDashoffset={circumference * (1 - progress / 100)} transform="rotate(-90 256 256)" />}</>}
    <g fill="none" stroke="currentColor" strokeWidth="32" strokeLinecap="round" strokeLinejoin="round">
      {status === "SUCCESS" && <path d="M336 189L224 323L176 269.4" />}
      {["FAILURE", "FAILED"].includes(status) && <path d="M320 320L192 192M192 320l128-128" />}
      {["ABORTED", "DISABLED"].includes(status) && <path d="M192 320l128-128" />}
      {status === "DISABLED" && <ellipse cx="256" cy="256" rx="100" ry="100" />}
      {status === "UNSTABLE" && <><path d="M250.26 166.05L256 288l5.73-121.95a5.74 5.74 0 00-5.79-6h0a5.74 5.74 0 00-5.68 6z" /><ellipse cx="256" cy="350" rx="26" ry="26" fill="currentColor" stroke="none" /></>}
      {status === "PAUSED_PENDING_INPUT" && <path d="M208 192v128M304 192v128" />}
      {status === "NOT_EXECUTED" && <g transform="translate(51 51) scale(.8)"><path d="M216 352l96-96-96-96" transform="translate(-55 0)" /><path d="M216 352l96-96-96-96" transform="translate(75 0)" /></g>}
      {status === "QUEUED" && <g transform="translate(102 102) scale(.6)"><path d="M145.61 464h220.78c19.8 0 35.55-16.29 33.42-35.06C386.06 308 304 310 304 256s83.11-51 95.8-172.94c2-18.78-13.61-35.06-33.41-35.06H145.61c-19.8 0-35.37 16.28-33.41 35.06C124.89 205 208 201 208 256s-82.06 52-95.8 172.94c-2.14 18.77 13.61 35.06 33.41 35.06z" /><path fill="currentColor" stroke="none" d="M343.3 432H169.13c-15.6 0-20-18-9.06-29.16C186.55 376 240 356.78 240 326V224c0-19.85-38-35-61.51-67.2-3.88-5.31-3.49-12.8 6.37-12.8h142.73c8.41 0 10.23 7.43 6.4 12.75C310.82 189 272 204.05 272 224v102c0 30.53 55.71 47 80.4 76.87 9.95 12.04 6.47 29.13-9.1 29.13z" /></g>}
    </g>
    {!["SUCCESS", "FAILURE", "FAILED", "UNSTABLE", "ABORTED", "DISABLED", "IN_PROGRESS", "PAUSED_PENDING_INPUT", "NOT_EXECUTED", "QUEUED"].includes(status) && [160, 256, 352].map((x) => <circle key={x} cx={x} cy="256" r="30" fill="currentColor" />)}
  </svg>;
}
