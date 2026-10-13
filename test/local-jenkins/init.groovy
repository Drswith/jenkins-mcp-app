import hudson.model.FreeStyleProject
import hudson.security.FullControlOnceLoggedInAuthorizationStrategy
import hudson.security.HudsonPrivateSecurityRealm
import hudson.tasks.Shell
import hudson.plugins.git.GitSCM
import jenkins.model.Jenkins
import jenkins.model.JenkinsLocationConfiguration
import jenkins.security.ApiTokenProperty
import groovy.json.JsonOutput

import java.nio.file.Files
import java.nio.file.Path
import java.security.SecureRandom
import java.util.Base64

def jenkins = Jenkins.get()
def controllerUrl = System.getenv("JENKINS_TEST_URL") ?: "http://127.0.0.1:8080/"
def scmUrl = System.getenv("JENKINS_TEST_SCM_URL") ?: "git://git-fixture:9418/sample.git"
def credentialsPath = Path.of(jenkins.rootDir.absolutePath, "local-test-credentials.json")
if (!Files.exists(credentialsPath)) {
  def random = new byte[24]
  new SecureRandom().nextBytes(random)
  def password = Base64.getUrlEncoder().withoutPadding().encodeToString(random)
  def realm = new HudsonPrivateSecurityRealm(false)
  def user = realm.createAccount("codex-test", password)
  jenkins.setSecurityRealm(realm)
  def authorization = new FullControlOnceLoggedInAuthorizationStrategy()
  authorization.setAllowAnonymousRead(false)
  jenkins.setAuthorizationStrategy(authorization)

  def token = user.getProperty(ApiTokenProperty.class).tokenStore.generateNewToken("local-plugin-test").plainValue
  user.save()
  def job = jenkins.createProject(FreeStyleProject.class, "codex-smoke")
  job.buildersList.add(new Shell("echo 'Jenkins Codex local test build'"))
  job.save()
  JenkinsLocationConfiguration.get().setUrl(controllerUrl)
  jenkins.save()

  Files.writeString(credentialsPath, JsonOutput.toJson([
    JENKINS_URL: controllerUrl,
    JENKINS_USER: "codex-test",
    JENKINS_API_TOKEN: token,
    JENKINS_MODE: "mcp",
    testPassword: password
  ]))
  credentialsPath.toFile().setReadable(false, false)
  credentialsPath.toFile().setReadable(true, true)
  credentialsPath.toFile().setWritable(false, false)
  credentialsPath.toFile().setWritable(true, true)
}

if (!jenkins.getItem("codex-scm-smoke")) {
  def scmJob = jenkins.createProject(FreeStyleProject.class, "codex-scm-smoke")
  scmJob.setScm(new GitSCM(scmUrl))
  scmJob.buildersList.add(new Shell("git log -1 --format='%h %s'"))
  scmJob.save()
}
