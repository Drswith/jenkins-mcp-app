import { AppBridge, PostMessageTransport } from "@modelcontextprotocol/ext-apps/app-bridge";

const query = new URLSearchParams(location.search);
const mode = query.get("mode") || "workspace";
const scenario = query.get("scenario") || "failed";
const requestedJob = query.get("job");
const requestedBuild = Number(query.get("build"));
const requestedQueue = Number(query.get("queue"));
const initialTheme = query.get("theme") === "dark" ? "dark" : "light";
const live = document.body.dataset.live === "true";
const iframe = document.querySelector("iframe");
iframe.src = `/widget/${["workspace", "card"].includes(mode) ? mode : "workspace"}`;

const jobs = [
  { name: "checkout-api", fullName: "platform/checkout-api", color: "red", lastBuild: { number: 284, result: "FAILURE", timestamp: Date.now() - 600000, duration: 252000 } },
  { name: "user-service", fullName: "platform/user-service", color: "blue", lastBuild: { number: 512, result: "SUCCESS", timestamp: Date.now() - 1500000, duration: 168000 } },
];

function buildFor(name) {
  const job = jobs.find((item) => item.fullName === name) || jobs[0];
  return { ...job.lastBuild, url: `https://jenkins.example.com/job/${job.name}/${job.lastBuild.number}/`, description: job.color === "red" ? "预发布环境部署时就绪探针失败。" : "构建完成。" };
}

let queueReads = 0;
let buildReads = 0;
function scenarioBuild() {
  if (["running", "running-no-stages", "queue"].includes(scenario)) {
    buildReads += 1;
    const completed = scenario === "queue" && buildReads >= 3;
    return { number: 285, result: completed ? "SUCCESS" : null, building: !completed, timestamp: Date.now() - 134000, previousBuild: { number: 284, duration: 252000 }, duration: completed ? 188000 : 0, url: "https://jenkins.example.com/job/checkout-api/285/" };
  }
  return scenario === "success" ? { number: 285, result: "SUCCESS", building: false, timestamp: Date.now() - 350000, duration: 188000, url: "https://jenkins.example.com/job/checkout-api/285/" } : buildFor(jobs[0].fullName);
}

function reply(data) {
  return { content: [{ type: "text", text: JSON.stringify(data) }], structuredContent: data };
}

const bridge = new AppBridge(null, { name: "Jenkins UI preview", version: "0.1.0" }, { serverTools: {}, openLinks: {}, message: { text: {} }, updateModelContext: { text: {} }, experimental: { "openai/message": {}, "openai/modelContext": {} } }, { hostContext: { theme: initialTheme, platform: "desktop", displayMode: "inline", availableDisplayModes: ["inline", "fullscreen"] } });
const themeSelect = document.querySelector("#theme");
themeSelect.value = initialTheme;
function setPreviewTheme(theme) {
  document.body.dataset.theme = theme;
  for (const link of document.querySelectorAll("nav a")) {
    const url = new URL(link.href);
    url.searchParams.set("theme", theme);
    link.href = url.href;
  }
}
setPreviewTheme(initialTheme);
themeSelect.addEventListener("change", () => {
  setPreviewTheme(themeSelect.value);
  bridge.setHostContext({ theme: themeSelect.value });
});
bridge.oncalltool = async ({ name, arguments: args }) => {
  if (live) {
    const response = await fetch("/tool", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, arguments: args ?? {} }) });
    return response.json();
  }
  if (name === "uiGetWatchedJobs") return reply({ jobs: jobs.map((job)=>({jobFullName:job.fullName,url:`https://jenkins.example.com/job/${job.name}/`,build:buildFor(job.fullName)})) });
  if (name === "uiGetBuildEvidence") return reply({ build: scenarioBuild(), stages: { available: true, stages: [{name:"检出",status:"SUCCESS",durationMillis:6000},{name:"构建",status:"SUCCESS",durationMillis:70000},{name:"部署",status:"FAILED",durationMillis:42000}] }, log: { lines: [{number:109,text:"Readiness probe: GET /healthz → 404"},{number:110,text:"ERROR: Readiness probe failed"},{number:111,text:"ERROR: pod checkout-api not ready"}], readLines: 1204, truncated: false }, changes: { available:true,baselineBuildNumber:283,commits:[{commitId:"9f3c2ab",msg:"health: move readiness to /health",author:"Alex"}] } });
  if (name === "uiListJobs") return reply({ jobs });
  if (name === "uiGetJob") return reply({ jobs, lastBuild: buildFor(args.jobFullName) });
  if (name === "uiGetJobParameters") return reply({ jobFullName: args.jobFullName, parameters: [
    { name: "BRANCH", type: "git", gitType: "PT_BRANCH", description: "选择合成分支", defaultValue: "master" },
    { name: "ENV", type: "choice", choices: ["dev", "staging"], defaultValue: "dev" },
  ] });
  if (name === "uiGetGitParameterChoices") return reply({ choices: [{name:"master",value:"master"},{name:"develop",value:"develop"}], errors:[], truncated:false });
  if (name === "uiGetBuild") return reply(mode === "card" ? scenarioBuild() : buildFor(args.jobFullName));
  if (name === "uiGetBuildStages") {
    if (scenario === "running-no-stages") return reply({ available: false, stages: [] });
    const current = buildReads >= 2 ? 2 : 1;
    return reply({ available: true, stages: ["检出", "构建", "测试", "部署"].map((name, index) => ({ name, status: scenario === "success" ? "SUCCESS" : scenario === "failed" ? index < 3 ? "SUCCESS" : "FAILED" : index < current ? "SUCCESS" : index === current ? "IN_PROGRESS" : "NOT_EXECUTED" })) });
  }
  if (name === "uiGetQueueItem") return reply({ id: 71, why: queueReads++ ? null : "等待空闲执行器", task: { fullName: jobs[0].fullName }, ...(queueReads >= 2 ? { executable: { number: 285 } } : {}) });
  if (name === "uiTrackQueue") {
    queueReads++;
    return reply(queueReads >= 2 ? {view:"card",jobFullName:jobs[0].fullName,build:scenarioBuild()} : {view:"queue",jobFullName:jobs[0].fullName,queueId:71,queue:{id:71,why:"等待空闲执行器",task:{fullName:jobs[0].fullName}}});
  }
  if (name === "uiGetBuildLog") return reply({ log: "[INFO] Deploying to staging...\n[ERROR] Readiness probe failed\nFinished: FAILURE" });
  return { isError: true, content: [{ type: "text", text: "未知工具" }] };
};
bridge.onupdatemodelcontext = async ({ content }) => { document.querySelector("#message").textContent = content?.[0]?.text || "附件已移除"; bridge.setHostContext({ "openai/modelContext": content.length ? { updateId: crypto.randomUUID(), content } : null }); return {}; };
bridge.onmessage = async ({ content }) => { document.querySelector("#message").textContent = content?.[0]?.text || ""; return {}; };
bridge.onopenlink = async ({ url }) => { document.querySelector("#message").textContent = `将打开：${url}`; return {}; };
bridge.onrequestdisplaymode = async ({ mode: next }) => { iframe.classList.toggle("expanded", next === "fullscreen"); bridge.setHostContext({displayMode: next}); return { mode: next }; };
bridge.onsizechange = ({height}) => {
  if(mode==='card'&&Number.isFinite(height)&&height>0)iframe.style.height=`${Math.ceil(height)}px`;
};
bridge.oninitialized = async () => {
  let selected = jobs[0];
  if (live && mode !== "workspace") {
    if (requestedJob) selected = {fullName:requestedJob};
    else {
      const result = await bridge.oncalltool({ name: "uiListJobs", arguments: {} });
      selected = result.structuredContent?.jobs?.find((job) => job.lastBuild) ?? result.structuredContent?.jobs?.[0];
    }
  }
  const buildNumber=Number.isInteger(requestedBuild)&&requestedBuild>0?requestedBuild:selected?.lastBuild?.number;
  const args = mode === "workspace" || !selected ? {} : { jobFullName: selected.fullName, ...(buildNumber ? { buildNumber } : {}) };
  await bridge.sendToolInput({ arguments: args });
  const mockCard = scenario === "confirmation" ? {view:"confirmation",jobFullName:"infra/deploy-staging",parameters:[{name:"BRANCH",type:"string",defaultValue:"main",value:"release/2.4"},{name:"REGION",type:"choice",choices:["ap-southeast-1","eu-west-1"],defaultValue:"ap-southeast-1",value:"ap-southeast-1"},{name:"DRY_RUN",type:"boolean",defaultValue:true,value:false}]} : scenario === "queue" ? { view: "queue", jobFullName: jobs[0].fullName, queueId: 71, queue: { id: 71, why: "等待空闲执行器", task: { fullName: jobs[0].fullName } } }
    : scenario === "choices" ? { view: "choices", filter: "all", jobs }
      : scenario === "comparison" ? { view: "comparison", jobFullName: jobs[0].fullName, before: { number: 283, result: "SUCCESS", duration: 170000 }, after: buildFor(jobs[0].fullName) }
        : { view: "card", jobFullName: jobs[0].fullName, build: scenarioBuild() };
  const result = live && mode === "card" && selected
    ? await bridge.oncalltool({ name: Number.isInteger(requestedQueue)&&requestedQueue>0 ? "showJenkinsQueueCard" : "showJenkinsBuildCard", arguments: Number.isInteger(requestedQueue)&&requestedQueue>0?{jobFullName:selected.fullName,queueId:requestedQueue}:args })
    : reply(mode === "card" ? mockCard : { view: mode, ...args });
  await bridge.sendToolResult(result);
};
bridge.connect(new PostMessageTransport(iframe.contentWindow, iframe.contentWindow)).catch((error) => {
  document.querySelector("#message").textContent = error.message;
});
