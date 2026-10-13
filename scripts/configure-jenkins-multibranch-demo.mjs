import { readFile, writeFile, stat } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { j, g, xml, jobPath, repoPath, gitAccess, giteaUrl, internalGit, jenkinsUrl, sleep } from "./seed-jenkins-demo.mjs";

const flags = new Set(process.argv.slice(2));
if (!flags.size || [...flags].some((flag) => !["--configure", "--timer", "--keep-orphans", "--scan", "--daily", "--verify"].includes(flag))) throw new Error("Use --configure, --timer, --keep-orphans, --scan, --daily or --verify");
const repo = "demo-multibranch-lab", project = "demo-multibranch", daily = "demo-daily-history", bot = "demo-ci-bot";
const accessPath = ".local/jenkins-demo/multibranch-ci-bot-access.json";
const groovy = (value) => `'${String(value).replaceAll("\\", "\\\\").replaceAll("'", "\\'").replaceAll("\n", "\\n").replaceAll("\r", "\\r")}'`;
async function scriptText(script, marker) {
  const response = await j("scriptText", { method: "POST", contentType: "application/x-www-form-urlencoded", data: new URLSearchParams({ script }).toString() });
  if (!String(response.value).includes(marker)) {
    // A compilation diagnostic may include injected credentials: keep it private.
    await writeFile(".local/jenkins-demo/multibranch-private-diagnostic.txt", String(response.value), { mode: 0o600 });
    throw new Error("Jenkins setup did not return its success marker; see the private diagnostic file");
  }
  return String(response.value);
}
async function configureBot() {
  if (!(await g(repoPath(repo))).value.description?.startsWith("[DEMO]")) throw new Error("Unmarked target repository");
  const existing = await g(`api/v1/users/${bot}`, { allow404: true });
  let access;
  try {
    access = JSON.parse(await readFile(accessPath, "utf8"));
    if (((await stat(accessPath)).mode & 0o077) !== 0 || access.username !== bot) throw new Error("Unsafe bot access file");
  } catch (error) { if (error.code !== "ENOENT") throw error; }
  if (existing && (!existing.value.full_name?.startsWith("[DEMO]") || existing.value.is_admin || !access)) throw new Error("Existing bot account is not the private demo fixture");
  if (!access) {
    access = { username: bot, password: randomBytes(36).toString("base64url") };
    await writeFile(accessPath, JSON.stringify(access), { mode: 0o600, flag: "wx" });
  }
  if (!existing) await g("api/v1/admin/users", { method: "POST", data: { username: bot, email: "ci-bot@example.invalid", password: access.password, full_name: "[DEMO] SG CI automation", visibility: "private", must_change_password: false, send_notify: false } });
  await g(`${repoPath(repo)}/collaborators/${bot}`, { method: "PUT", data: { permission: "write" } });
  if ((await g(`${repoPath(repo)}/collaborators/${bot}/permission`)).value.permission !== "write") throw new Error("Bot repository permission did not verify");
  if (!access.token) {
    const response = await fetch(new URL(`api/v1/users/${bot}/tokens`, giteaUrl), { method: "POST", headers: { Authorization: `Basic ${Buffer.from(`${bot}:${access.password}`).toString("base64")}`, "Content-Type": "application/json" }, body: JSON.stringify({ name: "demo-multibranch-ci", scopes: ["write:repository", "read:user"] }), redirect: "manual", signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error(`Bot token creation: HTTP ${response.status}`);
    access.token = (await response.json()).sha1;
    if (!access.token) throw new Error("Missing bot token");
    await writeFile(accessPath, JSON.stringify(access), { mode: 0o600 });
  }
  return access;
}

const dailyScript = `node {
  timeout(time:60,unit:'SECONDS') {
    stage('检出每日演示仓库') {
      checkout([$class:'GitSCM',branches:[[name:'*/master']],userRemoteConfigs:[[url:'${internalGit}/${gitAccess.user}/${repo}.git',credentialsId:'demo-ci-bot-git']],extensions:[]])
    }
    stage('每天最多一个提交') {
      String day=sh(script:'TZ=Asia/Shanghai date +%F',returnStdout:true).trim()
      String prior=fileExists('ci/daily-history.json')?readFile('ci/daily-history.json'):''
      currentBuild.description='[演示数据] daily='+day+' synthetic=true'
      if(prior.contains('"date":"'+day+'"')) {
        echo '[DEMO] Date already recorded; no duplicate commit'
      } else {
        long epochDay=sh(script:'date +%s',returnStdout:true).trim().toLong().intdiv(86400)
        String scenario=epochDay%7==0?'failure':(epochDay%5==0?'unstable':'success')
        String expected=[success:'SUCCESS',unstable:'UNSTABLE',failure:'FAILURE'][scenario]
        writeFile file:'ci/daily-history.json',text:'{"date":"'+day+'","scenario":"'+scenario+'","expected_result":"'+expected+'","demo":true}\\n'
        writeFile file:'ci/scenario.txt',text:scenario+'\\n'
        withCredentials([usernamePassword(credentialsId:'demo-ci-bot-git',usernameVariable:'DEMO_BOT_USER',passwordVariable:'DEMO_BOT_TOKEN')]) {
          sh '''#!/bin/sh
set +x
set -eu
helper="$WORKSPACE/.demo-history-askpass"
trap 'rm -f "$helper"' EXIT HUP INT TERM
cat > "$helper" <<'ASK'
#!/bin/sh
case "$1" in
  *Username*) printf '%s\\n' "$DEMO_BOT_USER" ;;
  *Password*) printf '%s\\n' "$DEMO_BOT_TOKEN" ;;
esac
ASK
chmod 700 "$helper"
export GIT_ASKPASS="$helper" GIT_TERMINAL_PROMPT=0
git config user.name '[DEMO] CI bot'
git config user.email 'ci-bot@example.invalid'
git add -- ci/daily-history.json ci/scenario.txt
git commit -m "ci: daily synthetic history $(TZ=Asia/Shanghai date +%F)"
git push origin HEAD:master
'''
        }
        echo '[DEMO] Daily commit created; webhook handles branch and PR builds'
      }
    }
    stage('延迟扫描 PR 合并目标') {
      // The push webhook builds master. A short delayed scan also notices changed PR base revisions.
      build job:'demo-multibranch',wait:false,quietPeriod:15
    }
  }
}`;
function dailyXml() {
  return `<?xml version="1.0" encoding="UTF-8"?><flow-definition plugin="workflow-job"><description>[演示数据] SG 每日自然历史。每天最多一个演示提交，通过 webhook 触发 Multibranch，禁止生产部署。</description><keepDependencies>false</keepDependencies><properties><org.jenkinsci.plugins.workflow.job.properties.DisableConcurrentBuildsJobProperty><abortPrevious>false</abortPrevious></org.jenkinsci.plugins.workflow.job.properties.DisableConcurrentBuildsJobProperty><jenkins.model.BuildDiscarderProperty><strategy class="hudson.tasks.LogRotator"><daysToKeep>60</daysToKeep><numToKeep>60</numToKeep><artifactDaysToKeep>1</artifactDaysToKeep><artifactNumToKeep>0</artifactNumToKeep></strategy></jenkins.model.BuildDiscarderProperty><org.jenkinsci.plugins.workflow.job.properties.PipelineTriggersJobProperty><triggers><hudson.triggers.TimerTrigger><spec>TZ=Asia/Shanghai\nH 3 * * *</spec></hudson.triggers.TimerTrigger></triggers></org.jenkinsci.plugins.workflow.job.properties.PipelineTriggersJobProperty></properties><definition class="org.jenkinsci.plugins.workflow.cps.CpsFlowDefinition" plugin="workflow-cps"><script>${xml(dailyScript)}</script><sandbox>true</sandbox></definition><disabled>false</disabled></flow-definition>`;
}
if (flags.has("--configure")) {
  const access = await configureBot();
  const setup = `import com.cloudbees.plugins.credentials.CredentialsScope
import com.cloudbees.plugins.credentials.SystemCredentialsProvider
import com.cloudbees.plugins.credentials.domains.Domain
import com.cloudbees.plugins.credentials.impl.UsernamePasswordCredentialsImpl
import org.jenkinsci.plugin.gitea.credentials.PersonalAccessTokenImpl
import org.jenkinsci.plugin.gitea.servers.*
import org.jenkinsci.plugin.gitea.*
import org.jenkinsci.plugins.workflow.multibranch.*
import jenkins.branch.*
import jenkins.model.Jenkins
def store=SystemCredentialsProvider.getInstance().getStore()
def domain=Domain.global()
def replacements=[new PersonalAccessTokenImpl(CredentialsScope.GLOBAL,'demo-ci-bot-pat','[演示数据] limited CI repository token',${groovy(access.token)}),new UsernamePasswordCredentialsImpl(CredentialsScope.GLOBAL,'demo-ci-bot-git','[演示数据] limited daily Git push',${groovy(bot)},${groovy(access.token)})]
replacements.each { replacement ->
  def old=store.getCredentials(domain).find { it.id==replacement.id }
  if(old && !old.description.startsWith('[演示数据]')) throw new IllegalStateException('Unmarked credential ID')
  if(old) store.updateCredentials(domain,old,replacement); else store.addCredentials(domain,replacement)
}
def registry=GiteaServers.get()
def servers=new ArrayList(registry.servers)
def oldServer=servers.find { it.serverUrl==${groovy(internalGit)} }
if(oldServer && !oldServer.displayName.startsWith('[演示数据]')) throw new IllegalStateException('Unmarked Gitea server')
if(oldServer) servers.remove(oldServer)
servers.add(new GiteaServer('[演示数据] SG Gitea',${groovy(internalGit)},false,null,${groovy(giteaUrl.href.replace(/\/$/, ""))}))
registry.setServers(servers); registry.save()
def controller=Jenkins.get()
def p=controller.getItemByFullName('${project}')
if(p && (!(p instanceof WorkflowMultiBranchProject)||!p.description.startsWith('[演示数据]'))) throw new IllegalStateException('Unmarked multibranch item')
if(!p) p=controller.createProject(WorkflowMultiBranchProject,'${project}')
p.setDescription('[演示数据] Gitea 分支与 PR 自动发现；只处理合成仓库')
def src=new GiteaSCMSource(${groovy(internalGit)},${groovy(gitAccess.user)},'${repo}')
src.setId('demo-multibranch-source'); src.setCredentialsId('demo-ci-bot-pat')
src.setTraits([new BranchDiscoveryTrait(1),new OriginPullRequestDiscoveryTrait(1),new WebhookRegistrationTrait('DISABLE')])
p.setSourcesList([new BranchSource(src,new DefaultBranchPropertyStrategy([] as BranchProperty[]))])
def factory=new WorkflowBranchProjectFactory(); factory.setScriptPath('Jenkinsfile'); p.setProjectFactory(factory)
p.setOrphanedItemStrategy(new com.cloudbees.hudson.plugins.folder.computed.DefaultOrphanedItemStrategy(false,'-1','-1'))
p.save()
println('DEMO_SETUP_OK')`;
  await scriptText(setup, "DEMO_SETUP_OK");
  const current = await j(`${jobPath(daily)}api/json?tree=description`, { allow404: true });
  if (current && !current.value.description?.startsWith("[演示数据]")) throw new Error("Unmarked daily job");
  await j(current ? `${jobPath(daily)}config.xml` : `createItem?name=${daily}`, { method: "POST", contentType: "application/xml", data: dailyXml() });
  const url = new URL("gitea-webhook/post", jenkinsUrl).href;
  const hooks = (await g(`${repoPath(repo)}/hooks`)).value;
  const hook = hooks.find((h) => h.config.url === url);
  if (hook && hook.name !== "[DEMO] Jenkins Multibranch") throw new Error("Unmarked existing webhook target");
  if (!hook) await g(`${repoPath(repo)}/hooks`, { method: "POST", data: { type: "gitea", name: "[DEMO] Jenkins Multibranch", config: { url, content_type: "json" }, events: ["push", "pull_request"], active: true } });
  console.log("Multibranch, limited bot credentials, repository webhook and daily timer configured.");
}
if (flags.has("--timer")) {
  const current = (await j(`${jobPath(daily)}api/json?tree=description`)).value;
  if (!current.description?.startsWith("[演示数据]")) throw new Error("Unmarked daily timer target");
  await j(`${jobPath(daily)}config.xml`, { method: "POST", contentType: "application/xml", data: dailyXml() });
  console.log("Daily timer definition updated.");
}
if (flags.has("--keep-orphans")) {
  await scriptText(`def p=jenkins.model.Jenkins.get().getItemByFullName('${project}')
assert p.description.startsWith('[演示数据]')
p.setOrphanedItemStrategy(new com.cloudbees.hudson.plugins.folder.computed.DefaultOrphanedItemStrategy(false,'-1','-1'))
p.save()
println('DEMO_ORPHANS_RETAINED')`, "DEMO_ORPHANS_RETAINED");
  console.log("Closed PR and orphan branch history retained.");
}
if (flags.has("--scan")) {
  const current = (await j(`${jobPath(project)}api/json?tree=fullName,_class`)).value;
  if (current.fullName !== project || !current._class.endsWith("WorkflowMultiBranchProject")) throw new Error("Unexpected indexing target");
  const response = await j(`${jobPath(project)}build?delay=0sec`, { method: "POST" });
  console.log(`Requested initial branch indexing: HTTP ${response.status}`);
}
if (flags.has("--daily")) {
  const current = (await j(`${jobPath(daily)}api/json?tree=fullName,buildable`)).value;
  if (current.fullName !== daily || !current.buildable) throw new Error("Daily demo is not buildable");
  const response = await j(`${jobPath(daily)}build`, { method: "POST" });
  const queueUrl = new URL(response.location, jenkinsUrl);
  if (queueUrl.origin !== jenkinsUrl.origin || !/^\/queue\/item\/\d+\/$/.test(queueUrl.pathname)) throw new Error("Unexpected daily queue URL");
  await writeFile(".local/jenkins-demo/daily-queue.json", JSON.stringify({ url: queueUrl.href }));
  console.log(`Queued daily history smoke run: ${queueUrl.href}`);
}
if (flags.has("--verify") || flags.has("--configure")) {
  const branches = (await j(`${jobPath(project)}api/json?tree=fullName,_class,jobs[name,displayName,fullName,color,lastBuild[number,result,building,url,timestamp,duration,description,actions[causes[*]]]]`)).value;
  const timer = await scriptText(`def job=jenkins.model.Jenkins.get().getItemByFullName('${daily}')
assert job.description.startsWith('[演示数据]')
def trigger=job.triggers.values().find { it instanceof hudson.triggers.TimerTrigger }
assert trigger
def hash=hudson.scheduler.Hash.from(job.fullName)
def next=hudson.scheduler.CronTabList.create(trigger.spec,hash).next()
println('DEMO_TIMER '+groovy.json.JsonOutput.toJson([spec:trigger.spec,nextUtc:next.time.format("yyyy-MM-dd'T'HH:mm:ssXXX",TimeZone.getTimeZone('UTC')),minute:next.get(Calendar.MINUTE),hour:next.get(Calendar.HOUR_OF_DAY),concurrent:job.isConcurrentBuild()]))`, "DEMO_TIMER ");
  const timerData = JSON.parse(timer.split("DEMO_TIMER ")[1].trim());
  const hooks = (await g(`${repoPath(repo)}/hooks`)).value.map((h) => ({ id: h.id, name: h.name, active: h.active, events: h.events, url: h.config.url }));
  const dailyState = (await j(`${jobPath(daily)}api/json?tree=fullName,buildable,lastBuild[number,result,building,timestamp,duration,description]`)).value;
  const report = { recordedAt: new Date().toISOString(), repository: repo, branches, timer: timerData, hooks, daily: dailyState };
  await writeFile(".local/jenkins-demo/multibranch-controller-summary.json", JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}
