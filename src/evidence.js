export function logEvidence(log, limit = 3) {
  const lines = String(log ?? "").split(/\r?\n/);
  if (lines.at(-1) === "") lines.pop();
  const count = Math.max(1, Math.min(10, Number.isInteger(limit) ? limit : 3));
  let match = lines.findLastIndex((line) => /\berror\b|\bfailed\b|\bexception\b|\bfatal\b|失败|错误/i.test(line) && !/^Finished: /i.test(line));
  if (match < 0) match = lines.length - 1;
  const start = Math.max(0, Math.min(match - Math.floor(count / 2), lines.length - count));
  return { lines: lines.slice(start, start + count).map((text, i) => ({ number: start + i + 1, text: text.slice(0, 1000), shortened: text.length > 1000 })), readLines: lines.length };
}

export function prepareParameters(definitions, proposed = {}) {
  const names = new Set(definitions.map((item) => item.name));
  if (Object.keys(proposed).some((key) => !names.has(key))) throw new Error("存在未声明的参数，请重新读取任务参数");
  return definitions.map((definition) => {
    const blocked = definition.sensitive || !["string", "choice", "boolean", "git"].includes(definition.type);
    if (blocked && Object.hasOwn(proposed, definition.name)) throw new Error("敏感或不支持的参数必须在 Jenkins 中填写");
    const value = blocked ? null : Object.hasOwn(proposed, definition.name) ? proposed[definition.name] : definition.defaultValue;
    if (value != null && (definition.type === "boolean" ? typeof value !== "boolean" : typeof value !== "string")) throw new Error("参数值类型不匹配");
    if (value != null && definition.type === "choice" && !definition.choices?.includes(value)) throw new Error("参数值不在声明的选项中");
    return { ...definition, value, blocked: Boolean(blocked), changed: value !== definition.defaultValue };
  });
}

export function changesSinceSuccess(builds, targetNumber) {
  const history = builds.filter((build) => Number.isInteger(build.number) && build.number <= targetNumber).sort((a, b) => b.number - a.number);
  const baseline = history.find((build) => build.number < targetNumber && !build.building && build.result === "SUCCESS");
  if (!baseline) return { available: false, reason: "最近 50 条历史中未找到此前成功构建，无法确定比较范围", commits: [] };
  const seen = new Set();
  const commits = [];
  for (const build of history.filter((item) => item.number > baseline.number)) {
    const items = [...(build.changeSet?.items ?? []), ...(build.changeSets ?? []).flatMap((set) => set.items ?? [])];
    for (const item of items) {
      const key = item.commitId || JSON.stringify([item.msg, item.author?.fullName]);
      if (seen.has(key)) continue;
      seen.add(key);
      commits.push({ commitId: item.commitId ?? null, msg: item.msg ?? "", author: item.author?.fullName ?? null });
    }
  }
  return { available: true, baselineBuildNumber: baseline.number, commits };
}
