import { writeFile } from "node:fs/promises";

if (!["--run", "--verify", "--git-only", "--build-only"].some((flag) => process.argv.includes(flag))) throw new Error("Use --run, --verify, --git-only or --build-only");
process.env.JENKINS_DEMO_REPORT_PREFIX = "broad-";
const { j, g, xml, jobPath, repoPath, gitAccess, internalGit, jenkinsUrl, parametersXml, jobXml, putFile, branch, tag, schedule, finishBuild, verify, jobs: baseJobs, repositories: baseRepositories, buildScript, sleep } = await import("./seed-jenkins-demo.mjs");
const { jobs: extendedJobs, privateRepository, finishQueue } = await import("./seed-jenkins-extended-demo.mjs");
const repository = { name: "demo-ci-lab", title: "高级 CI 场景" };
const archivedRepository = { name: "demo-archived-project", title: "只读归档项目" };
const emptyRepository = { name: "demo-empty-repository", title: "未初始化空仓库" };
const checkout = `checkout([$class: 'GitSCM', branches: [[name: '*/master']], userRemoteConfigs: [[url: '${internalGit}/${gitAccess.user}/${repository.name}.git']], extensions: []])`;
const standard = "sh ci/demo-build.sh\n";
const report = (count, unicode = false) => standard + `rm -f reports/*.xml
printf '<testsuite name="${unicode ? "中文合约" : "ScaleSuite"}" tests="${count}" failures="0">' > reports/scale.xml
i=1; while [ "$i" -le ${count} ]; do
 printf '<testcase classname="${unicode ? "demo.订单校验" : "demo.ScaleSuite"}" name="${unicode ? "金额 &amp; 币种" : "scale"}_%03d" time="0.03">' "$i" >> reports/scale.xml
 if [ "$SCENARIO" = unstable ] && [ "$i" -le 3 ]; then printf '<failure message="Demo failure">Synthetic stack trace\\n订单校验失败</failure>' >> reports/scale.xml; fi
 printf '<system-out>Demo diagnostic output</system-out><system-err>Demo warning</system-err></testcase>' >> reports/scale.xml
 i=$((i+1))
done
printf '</testsuite>\\n' >> reports/scale.xml`;
const pipelineScm = `node {
  stage('SCM Jenkinsfile') { ${checkout} }
  try { stage('构建与测试') { sh 'sh ci/demo-build.sh'; junit 'reports/*.xml' } }
  finally { stage('归档') { archiveArtifacts artifacts: 'artifacts/*', allowEmptyArchive: true } }
}`;
const jobs = [
  { name: "demo-pipeline-retry", title: "暂时错误后 retry 成功", script: "int attempt=0; stage('重试') { retry(3) { attempt++; echo 'Demo attempt '+attempt; if(attempt<3) error('Synthetic transient failure'); sh 'printf retry-recovered > retry.txt' } }", results: ["success", "success", "success"] },
  { name: "demo-pipeline-retry-exhausted", title: "重试耗尽与恢复", script: "stage('重试预算') { retry(2) { if(params.SCENARIO=='failure') error('Demo retry budget exhausted'); echo 'Dependency fixture recovered' } }", results: ["failure", "failure", "success"] },
  { name: "demo-pipeline-catch-error", title: "catchError 继续运行，阶段失败但整体不稳定", script: "stage('捕获异常') { catchError(buildResult:'UNSTABLE', stageResult:'FAILURE') { if(params.SCENARIO=='unstable') sh 'exit 7'; echo 'Validation passed' } }; stage('继续执行') { echo 'Runs after caught error' }", results: ["unstable", "success", "unstable"] },
  { name: "demo-pipeline-timeout", title: "Pipeline timeout 真实中止与恢复", script: "stage('超时控制') { timeout(time:2,unit:'SECONDS') { if(params.SCENARIO=='aborted') sh 'sleep 8'; else echo 'Completed within budget' } }", cancelOnStart: false, results: ["aborted", "aborted", "success"] },
  { name: "demo-input-approved", title: "input 等待后真实批准", script: "stage('人工闸门演示') { timeout(time:60,unit:'SECONDS') { input id:'demoGate', message:'[DEMO] Approve synthetic fixture only' } }; stage('批准后执行') { echo 'Demo approval recorded' }", inputAction: "proceedEmpty", results: ["success", "success", "success"] },
  { name: "demo-input-rejected", title: "input 等待后真实拒绝", script: "stage('人工闸门演示') { timeout(time:60,unit:'SECONDS') { input id:'demoGate', message:'[DEMO] Reject synthetic fixture only' } }", inputAction: "abort", cancelOnStart: false, results: ["aborted", "aborted", "aborted"] },
  { name: "demo-pipeline-stash", title: "stash 与 unstash 跨工作目录传递", script: "stage('暂存') { writeFile file:'stash-demo.txt',text:'Synthetic stash fixture'; stash name:'demoTransfer',includes:'stash-demo.txt' }; stage('恢复') { dir('received') { deleteDir(); unstash 'demoTransfer'; sh 'test -s stash-demo.txt'; archiveArtifacts artifacts:'stash-demo.txt',fingerprint:true } }", results: ["success", "success", "success"] },
  { name: "demo-workspace-cleanup", title: "清理工作目录后重新检出", script: `stage('清理') { deleteDir() }; stage('重新检出') { ${checkout}; sh 'test -s README.md' }; stage('清理证明') { writeFile file:'cleanup-proof.txt',text:'Workspace recreated from Git'; archiveArtifacts 'cleanup-proof.txt' }`, noCheckout: true, results: ["success", "success", "success"] },
  { name: "demo-command-return-status", title: "捕获非零退出码并显式设置构建结果", script: "stage('返回码') { int code=sh(script:params.SCENARIO=='unstable'?'exit 4':'exit 0',returnStatus:true); echo 'Demo exit code='+code; if(code!=0) currentBuild.result='UNSTABLE' }; stage('继续') { echo 'Exit status handled' }", results: ["success", "unstable", "success"] },
  { name: "demo-platform-matrix", title: "四个模拟平台组合并行校验", script: "stage('平台组合') { def branches=[:]; ['linux-arm64','linux-amd64','macos-arm64','windows-amd64'].each { name -> branches[name]={ echo '[DEMO] Fixture target '+name; if(name=='windows-amd64' && params.SCENARIO=='unstable') unstable('Synthetic optional platform failure'); else sh 'test -s README.md' } }; parallel branches }", results: ["success", "unstable", "success"] },
  { name: "demo-pipeline-from-scm", title: "从 Gitea 加载 Jenkinsfile 的 Pipeline", scmPipeline: true, results: ["success", "failure", "success"] },
  { name: "demo-multi-repository-pipeline", title: "同一 Pipeline 检出两个仓库，聚合变更集和测试", noCheckout: true, script: `stage('多个仓库') {
    dir('portal') { ${checkout}; sh 'sh ci/demo-build.sh' }
    dir('orders') { checkout([$class:'GitSCM',branches:[[name:'*/master']],userRemoteConfigs:[[url:'${internalGit}/${gitAccess.user}/demo-order-api.git']],extensions:[]]); sh 'sh ci/demo-build.sh' }
  }
  stage('聚合测试') { junit '**/reports/*.xml' }
  stage('多个仓库产物') { archiveArtifacts artifacts:'**/artifacts/*',allowEmptyArchive:true }`, results: ["success", "unstable", "success"] },
  { name: "demo-artifact-fingerprint", title: "产物指纹及跨构建相同内容关联", command: standard + "printf 'Stable synthetic artifact\\n' > artifacts/shared-fixture.txt", fingerprint: true, results: ["success", "success", "success"] },
  { name: "demo-multiple-test-suites", title: "聚合多个 JUnit 报告", command: standard + "printf '<testsuite name=\"ExtraSuite\" tests=\"2\"><testcase classname=\"demo.Extra\" name=\"smoke\"/><testcase classname=\"demo.Extra\" name=\"optional\"><skipped message=\"Demo optional\"/></testcase></testsuite>' > reports/extra.xml", results: ["success", "unstable", "success"] },
  { name: "demo-large-test-report", title: "180 测试项、失败堆栈和标准输出", command: report(180), results: ["success", "unstable", "success"] },
  { name: "demo-malformed-test-report", title: "损坏 XML 产生解析错误并标记不稳定，随后修复", command: "SCENARIO=success sh ci/demo-build.sh\nif [ \"$SCENARIO\" != success ]; then printf '<testsuite><broken>' > reports/junit.xml; fi", allowEmptyResults: false, results: ["unstable", "unstable", "success"] },
  { name: "demo-test-error-exception", title: "JUnit error 异常与失败堆栈，随后恢复", command: "SCENARIO=success sh ci/demo-build.sh\nif [ \"$SCENARIO\" = unstable ]; then printf '<testsuite name=\"ExceptionDemo\" tests=\"1\" errors=\"1\"><testcase classname=\"demo.DatabaseFixture\" name=\"connection_error\"><error type=\"DemoConnectionException\" message=\"Synthetic connection error\">demo.DatabaseFixture.connect:42</error></testcase></testsuite>' > reports/exception.xml; fi", results: ["success", "unstable", "success"] },
  { name: "demo-unicode-test-names", title: "中文与 XML 特殊字符测试名称", command: report(15, true), results: ["success", "unstable", "success"] },
  { name: "demo-test-duration-trend", title: "JUnit 用时增长趋势", command: standard + "sed -e \"s/time=\\\"0.2\\\"/time=\\\"$BUILD_NUMBER.2\\\"/g\" -e \"s/time=\\\"2.4\\\"/time=\\\"$BUILD_NUMBER.4\\\"/g\" reports/junit.xml > reports/duration.tmp\nmv reports/duration.tmp reports/junit.xml", results: ["success", "success", "success"] },
  { name: "demo-parameter-escaping", title: "中文、空格、引号与换行字符串参数", parameterXml: '<hudson.model.StringParameterDefinition><name>DEMO_MESSAGE</name><defaultValue>演示</defaultValue></hudson.model.StringParameterDefinition>', parameters: { DEMO_MESSAGE: "中文 空格 '双引号\" & < > $HOME\n第二行 ✅" }, command: standard + "printf '%s\\n' \"$DEMO_MESSAGE\" > 'artifacts/参数 回读.txt'", results: ["success", "success", "success"] },
  { name: "demo-no-scm", title: "无 SCM 的维护任务与空变更集", noScm: true, command: "mkdir -p artifacts\nprintf '[DEMO] No SCM or test report required\\n'\nprintf 'maintenance fixture\\n' > artifacts/maintenance.txt", results: ["success", "success", "success"] },
  { name: "demo-batch-changes", title: "一个构建汇集多个 Git 提交及文件增删", results: ["success", "success", "success"] },
  { name: "demo-empty-repo-checkout", title: "空仓库无可构建 revision", repo: emptyRepository.name, noCommitStatus: true, results: ["failure", "failure", "failure"] },
  { name: "demo-archived-repo-checkout", title: "归档仓库仍可只读构建", repo: archivedRepository.name, results: ["success", "success", "success"] },
  { name: "demo-build-display-name", title: "自定义构建名称和多行描述", script: "stage('元数据') { currentBuild.displayName='演示-'+params.RELEASE_VERSION+' #'+env.BUILD_NUMBER; currentBuild.description='[演示数据] 中文构建描述\\n环境：'+params.TARGET_ENV; echo 'Build metadata updated' }", results: ["success", "success", "success"] },
  { name: "demo-concurrent-builds", title: "同一任务四次构建及并发执行", command: standard + "echo '[DEMO] Distinct parameters keep queue items separate'", concurrent: true, parameters: { RUN_SECONDS: "6" }, results: ["success", "success", "success", "success"] },
].map((job) => ({ repo: repository.name, ...job }));
const selectedNames = process.argv.find((arg) => arg.startsWith("--jobs="))?.slice(7).split(",");
if (selectedNames?.some((name) => !jobs.some((job) => job.name === name))) throw new Error("Unknown advanced demo job selection");
const selectedJobs = selectedNames ? jobs.filter((job) => selectedNames.includes(job.name)) : jobs;

function pipelineXml(job) {
  const script = `node {
  echo '[DEMO] Synthetic advanced CI fixture'
  ${job.noCheckout ? "" : `stage('检出') { ${checkout} }`}
  ${job.script}
}`;
  const definition = job.scmPipeline
    ? `<definition class="org.jenkinsci.plugins.workflow.cps.CpsScmFlowDefinition" plugin="workflow-cps"><scm class="hudson.plugins.git.GitSCM" plugin="git"><configVersion>2</configVersion><userRemoteConfigs><hudson.plugins.git.UserRemoteConfig><url>${internalGit}/${gitAccess.user}/${job.repo}.git</url></hudson.plugins.git.UserRemoteConfig></userRemoteConfigs><branches><hudson.plugins.git.BranchSpec><name>*/master</name></hudson.plugins.git.BranchSpec></branches><extensions/></scm><scriptPath>Jenkinsfile</scriptPath><lightweight>true</lightweight></definition>`
    : `<definition class="org.jenkinsci.plugins.workflow.cps.CpsFlowDefinition" plugin="workflow-cps"><script>${xml(script)}</script><sandbox>true</sandbox></definition>`;
  return `<flow-definition plugin="workflow-job"><description>${xml(`[演示数据] ${job.title}。只处理合成夹具。`)}</description><keepDependencies>false</keepDependencies><properties><jenkins.model.BuildDiscarderProperty><strategy class="hudson.tasks.LogRotator"><daysToKeep>-1</daysToKeep><numToKeep>100</numToKeep><artifactDaysToKeep>-1</artifactDaysToKeep><artifactNumToKeep>100</artifactNumToKeep></strategy></jenkins.model.BuildDiscarderProperty>${parametersXml}</properties>${definition}<triggers/><disabled>false</disabled></flow-definition>`;
}
async function createRepository(repo, empty = false) {
  const existing = await g(repoPath(repo.name), { allow404: true });
  if (existing && !existing.value.description?.startsWith("[DEMO]")) throw new Error(`Unmarked repository: ${repo.name}`);
  if (!existing) await g("api/v1/user/repos", { method: "POST", data: { name: repo.name, description: `[DEMO] ${repo.title}; synthetic history only`, private: false, auto_init: !empty, default_branch: "master" } });
  if (!empty && !existing?.value.archived) {
    await putFile(repo.name, "README.md", `# ${repo.title}\n\n[演示数据] 仅用于 CI 场景验证，不连接生产服务。\n`, "docs: explain advanced demo fixtures");
    await putFile(repo.name, "VERSION", "3.0.0-demo\n", "chore: initialize advanced fixture version");
    await putFile(repo.name, "ci/demo-build.sh", buildScript, "ci: add synthetic fixture runner");
  }
}
async function seedJobs() {
  for (const job of selectedJobs) {
    const current = await j(`${jobPath(job.name)}api/json?tree=description`, { allow404: true });
    // Earlier XML updates without an explicit charset can leave a single Latin-1 decoding of UTF-8.
    const description = current?.value.description || "";
    const repairedDescription = Buffer.from(description, "latin1").toString("utf8");
    if (current && !description.startsWith("[演示数据]") && !repairedDescription.startsWith("[演示数据]")) throw new Error(`Unmarked job: ${job.name}`);
    let config = job.script || job.scmPipeline ? pipelineXml(job) : jobXml(job);
    if (job.fingerprint) config = config.replace("<fingerprint>false</fingerprint>", "<fingerprint>true</fingerprint>");
    if (job.concurrent) config = config.replace("<concurrentBuild>false</concurrentBuild>", "<concurrentBuild>true</concurrentBuild>");
    if (job.noScm) config = config.replace(/<scm class="hudson.plugins.git.GitSCM"[\s\S]*?<\/scm>/, '<scm class="hudson.scm.NullSCM"/>');
    await j(current ? `${jobPath(job.name)}config.xml` : `createItem?name=${encodeURIComponent(job.name)}`, { method: "POST", contentType: "application/xml", data: config });
    console.log(`Advanced job ready: ${job.name}`);
  }
}
async function handleInput(item) {
  let number;
  while (Date.now() - item.submittedAt < 240000) {
    if (!number) {
      const q = (await j(item.queue)).value;
      if (q.cancelled) throw new Error(`Input queue cancelled: ${item.job.name}`);
      number = q.executable?.number;
    }
    if (number) {
      const path = `${jobPath(item.job.name)}${number}/`;
      const pending = await j(`${path}wfapi/pendingInputActions`, { allow404: true });
      const input = pending?.value?.find((input) => input.id?.toLowerCase() === "demogate" && input.message?.startsWith("[DEMO]"));
      if (input) {
        await j(`${path}input/${encodeURIComponent(input.id)}/${item.job.inputAction}`, { method: "POST" });
        console.log(`Demo input ${item.job.inputAction}: ${item.job.name} #${number}`);
        return;
      }
      const build = (await j(`${path}api/json?tree=building,result`)).value;
      if (!build.building) throw new Error(`Input build completed before gate: ${item.job.name}`);
    }
    await sleep(500);
  }
  throw new Error(`Demo input gate did not appear: ${item.job.name}`);
}
async function run(job, round) {
  if (process.argv.includes("--resume")) {
    const existing = (await j(`${jobPath(job.name)}api/json?tree=builds[number,result,building,actions[parameters[name,value]]]`)).value.builds;
    const expected = { success: "SUCCESS", unstable: "UNSTABLE", failure: "FAILURE", aborted: "ABORTED" }[job.results[round - 1]];
    for (const build of existing) {
      const parameters = build.actions.flatMap((action) => action.parameters || []);
      if (build.building || build.result !== expected || !parameters.some((p) => p.name === "RELEASE_VERSION" && p.value === `1.${round}.0-demo`)) continue;
      if (job.inputAction) {
        const log = String((await j(`${jobPath(job.name)}${build.number}/consoleText`)).value);
        if (!(job.inputAction === "abort" ? /Rejected by|Aborted by/.test(log) : /Approved by/.test(log))) continue;
      }
      console.log(`Existing verified result: ${job.name} round ${round} #${build.number}`);
      return;
    }
  }
  const item = await schedule(job, round);
  await Promise.all([finishBuild(item), ...(job.inputAction ? [handleInput(item)] : [])]);
}
async function gitHistory() {
  const repo = repository.name, path = repoPath(repo);
  await putFile(repo, "config/conflict.txt", "baseline\n", "chore: establish merge conflict baseline");
  const history = (await g(`${path}/pulls?state=all&limit=100`)).value;
  async function pull(head, title, file, content) {
    const existing = history.find((p) => p.head.ref === head);
    if (existing) return existing;
    await branch(repo, head);
    await putFile(repo, file, content, `feat: ${title}`, head);
    return (await g(`${path}/pulls`, { method: "POST", data: { head, base: "master", title: `[演示] ${title}`, body: "合成 Git 协作记录，不用于生产发布。" } })).value;
  }
  const rejected = await pull("feature/closed-proposal", "关闭但未合并的提案", "docs/rejected-proposal.md", "# Demo rejected proposal\n");
  if (rejected.state === "open") {
    await g(`${path}/issues/${rejected.number}/comments`, { method: "POST", data: { body: "[演示] 经评审关闭提案，保留未合并历史。" } });
    await g(`${path}/pulls/${rejected.number}`, { method: "PATCH", data: { state: "closed" } });
  }
  const squash = await pull("feature/squash-history", "压缩合并多次迭代", "docs/squash-demo.md", "# Demo squash\nIteration 1\n");
  if (!squash.merged && squash.state === "open") {
    await putFile(repo, "docs/squash-demo.md", "# Demo squash\nIteration 1\nIteration 2\n", "docs: follow up squash review", "feature/squash-history");
    await g(`${path}/pulls/${squash.number}/reviews`, { method: "POST", data: { event: "COMMENT", body: "[演示] 代码评审评论：两次迭代合并为一份提交。" } });
    await g(`${path}/pulls/${squash.number}/merge`, { method: "POST", data: { do: "squash", merge_title_field: "feat: squash advanced demo history", delete_branch_after_merge: false } });
  }
  const conflict = await pull("feature/conflicting-config", "保留真实合并冲突", "config/conflict.txt", "feature selects fixture A\n");
  if (conflict.state === "open") await putFile(repo, "config/conflict.txt", "master selects fixture B\n", "chore: conflicting master fixture configuration");
  await putFile(repo, "config/feature-toggle.json", '{"demoEnabled":true}\n', "feat: enable synthetic feature toggle");
  await putFile(repo, "config/feature-toggle.json", '{"demoEnabled":false}\n', "revert: disable synthetic feature toggle after validation");
  const issueTitle = "[演示] 修复并回退配置，记录讨论与关闭";
  const existingIssue = (await g(`${path}/issues?state=all&type=issues&limit=100`)).value.find((i) => i.title === issueTitle);
  if (!existingIssue) {
    const issue = (await g(`${path}/issues`, { method: "POST", data: { title: issueTitle, body: "[演示] 配置变更、回退和讨论的历史夹具。" } })).value;
    for (const body of ["[演示] 已复现配置差异。", "[演示] 已回退开关并验证通过，关闭记录。"])
      await g(`${path}/issues/${issue.number}/comments`, { method: "POST", data: { body } });
    await g(`${path}/issues/${issue.number}`, { method: "PATCH", data: { state: "closed" } });
  }
  await tag(repo, "v3.0.0-demo");
  const releaseExists = (await g(`${path}/releases?limit=100`)).value.some((r) => r.tag_name === "v3.1.0-draft-demo");
  if (!releaseExists) await g(`${path}/releases`, { method: "POST", data: { tag_name: "v3.1.0-draft-demo", target_commitish: "master", name: "[演示] 尚未发布的草稿", body: "演示草稿发布状态，不代表真实发布。", draft: true, prerelease: true } });
}
async function roundData(round) {
  const authors = ["演示前端工程师", "演示测试工程师", "演示运维工程师"];
  for (let n = 1; n <= 3; n++) {
    const path = `docs/batch-change-${n}.md`, content = `# Demo change ${n}\nRound ${round}\n`;
    const previous = await g(`${repoPath(repository.name)}/contents/${path}?ref=master`, { allow404: true });
    if (previous && Buffer.from(previous.value.content, "base64").toString() === content) continue;
    await g(`${repoPath(repository.name)}/contents/${path}`, { method: previous ? "PUT" : "POST", data: { branch: "master", ...(previous ? { sha: previous.value.sha } : {}), content: Buffer.from(content).toString("base64"), message: `ci: advanced round ${round} change ${n}`, author: { name: authors[n - 1], email: `demo-role-${n}@example.invalid` } } });
  }
  if (selectedJobs.some((job) => job.name === "demo-multi-repository-pipeline")) await putFile("demo-order-api", "docs/multi-repository-progress.md", `# Multiple repository fixture\nRound ${round}\n`, `ci: multi repository fixture round ${round}`);
  if (round === 1) await putFile(repository.name, "docs/obsolete-demo.md", "# Obsolete demo file\n", "docs: add temporary fixture");
  if (round === 2) {
    const file = await g(`${repoPath(repository.name)}/contents/docs/obsolete-demo.md` , { allow404: true });
    if (file) await g(`${repoPath(repository.name)}/contents/docs/obsolete-demo.md`, { method: "DELETE", data: { sha: file.value.sha, branch: "master", message: "docs: delete obsolete fixture" } });
  }
}
if (process.argv.includes("--run") || process.argv.includes("--git-only")) {
  await createRepository(repository);
  await createRepository(archivedRepository);
  await createRepository(emptyRepository, true);
  await putFile(repository.name, "Jenkinsfile", pipelineScm, "ci: load Pipeline definition from SCM");
  await gitHistory();
  await g(repoPath(archivedRepository.name), { method: "PATCH", data: { archived: true } });
}
if (process.argv.includes("--run") || process.argv.includes("--build-only")) {
  await seedJobs();
  // Small batches keep cloud resource use bounded, and input gates always have a handler.
  for (let round = 1; round <= 3; round++) {
    await roundData(round);
    const selected = selectedJobs.filter((job) => !job.concurrent);
    for (let start = 0; start < selected.length; start += 4) await Promise.all(selected.slice(start, start + 4).map((job) => run(job, round)));
  }
  const concurrent = selectedJobs.find((job) => job.concurrent);
  if (concurrent) await Promise.all([1, 2, 3, 4].map((round) => run(concurrent, round)));
  await finishQueue();
}
const selectedRepositories = [...baseRepositories, privateRepository, repository, archivedRepository, emptyRepository];
// Empty repositories have no commits endpoint; summarize it separately below.
if (!process.argv.includes("--git-only")) await verify([...baseJobs, ...extendedJobs, ...jobs], selectedRepositories.filter((r) => r !== emptyRepository));
const empty = (await g(repoPath(emptyRepository.name))).value;
const metadata = {
  recordedAt: new Date().toISOString(),
  emptyRepository: { name: empty.name, empty: empty.empty },
  archivedRepository: { name: archivedRepository.name, archived: (await g(repoPath(archivedRepository.name))).value.archived },
  pulls: (await g(`${repoPath(repository.name)}/pulls?state=all&limit=100`)).value.map((p) => ({ number: p.number, title: p.title, state: p.state, merged: p.merged, mergeable: p.mergeable, head: p.head.ref })),
};
await writeFile(".local/jenkins-demo/broad-git-metadata.json", JSON.stringify(metadata, null, 2));
console.log(JSON.stringify(metadata, null, 2));
