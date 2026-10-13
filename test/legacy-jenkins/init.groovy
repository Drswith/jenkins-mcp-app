import hudson.security.FullControlOnceLoggedInAuthorizationStrategy
import hudson.security.HudsonPrivateSecurityRealm
import jenkins.model.Jenkins
import jenkins.model.JenkinsLocationConfiguration
import jenkins.security.ApiTokenProperty
import groovy.json.JsonOutput
import groovy.json.JsonSlurper
import com.cloudbees.plugins.credentials.CredentialsScope
import com.cloudbees.plugins.credentials.SystemCredentialsProvider
import com.cloudbees.plugins.credentials.domains.Domain
import com.cloudbees.plugins.credentials.impl.UsernamePasswordCredentialsImpl
import org.jenkinsci.plugin.gitea.credentials.PersonalAccessTokenImpl
import java.nio.file.Files
import java.nio.file.LinkOption
import java.security.SecureRandom
import java.util.Base64

def controller = Jenkins.get()
if (new File(controller.rootDir, '.migration/in-progress').isFile()) {
  controller.doQuietDown()
}

// Import only the three synthetic credentials used by the migrated fixtures.
// The mounted source is plaintext, so keep Jenkins quiet until it has been
// copied into the encrypted credentials store and removed from JENKINS_HOME.
def bootstrap = new File(controller.rootDir, '.migration/bootstrap-credentials.json')
if (Files.exists(bootstrap.toPath(), LinkOption.NOFOLLOW_LINKS)) {
  controller.doQuietDown()
  try {
    if (!Files.isRegularFile(bootstrap.toPath(), LinkOption.NOFOLLOW_LINKS) ||
        Files.isSymbolicLink(bootstrap.parentFile.toPath())) {
      throw new IllegalStateException()
    }
    def parsed = new JsonSlurper().parse(bootstrap)
    def records = parsed instanceof Map ? parsed.credentials : parsed
    if (!(records instanceof Collection)) throw new IllegalStateException()

    def allowedIds = ['demo-ci-bot-pat', 'demo-ci-bot-git', 'demo-gitea-readonly'] as Set
    def byId = [:]
    records.each { record ->
      if (!(record instanceof Map)) throw new IllegalStateException()
      def id = record.id?.toString()
      if (!allowedIds.contains(id)) return
      if (byId.containsKey(id) || record.kind?.toString() != 'userpass') throw new IllegalStateException()
      if (!(record.username instanceof String) || !record.username ||
          !(record.password instanceof String) || !record.password) throw new IllegalStateException()
      byId[id] = record
    }
    if (byId.keySet() != allowedIds) throw new IllegalStateException()

    def provider = SystemCredentialsProvider.getInstance()
    def store = provider.getStore()
    def domain = Domain.global()
    byId.each { id, record ->
      def description = '[迁移演示数据] ' + id
      def replacement = id == 'demo-ci-bot-pat'
        ? new PersonalAccessTokenImpl(CredentialsScope.GLOBAL, id, description, record.password)
        : new UsernamePasswordCredentialsImpl(CredentialsScope.GLOBAL, id, description, record.username, record.password)
      def existing = store.getCredentials(domain).find { it.id == id }
      def saved = existing
        ? store.updateCredentials(domain, existing, replacement)
        : store.addCredentials(domain, replacement)
      if (!saved) throw new IllegalStateException()
    }
    provider.save()
    controller.save()
    Files.delete(bootstrap.toPath())
    println('Installed the three allowlisted migration credentials; plaintext bootstrap file deleted. Jenkins remains in quiet-down.')
  } catch (Exception ignored) {
    // Do not include parser or credential data in startup logs. Retain the file
    // so a corrected bootstrap can be retried; quiet-down remains in effect.
    throw new IllegalStateException('Migration credential bootstrap failed; plaintext source retained and Jenkins remains in quiet-down.')
  }
}

def file = new File(controller.rootDir, 'legacy-test-credentials.json')
if (!file.exists()) {
  def random = new byte[32]
  new SecureRandom().nextBytes(random)
  def password = Base64.getUrlEncoder().withoutPadding().encodeToString(random)
  def realm = new HudsonPrivateSecurityRealm(false)
  def user = realm.createAccount('codex-test', password)
  controller.setSecurityRealm(realm)
  def authorization = new FullControlOnceLoggedInAuthorizationStrategy()
  authorization.setAllowAnonymousRead(false)
  controller.setAuthorizationStrategy(authorization)
  controller.setNumExecutors(1)
  def token = user.getProperty(ApiTokenProperty.class).tokenStore.generateNewToken('legacy-api-test').plainValue
  user.save()
  def url = System.getenv('JENKINS_TEST_URL')
  JenkinsLocationConfiguration.get().setUrl(url)
  controller.save()
  Files.write(file.toPath(), JsonOutput.toJson([
    JENKINS_URL:url, JENKINS_USER:'codex-test', JENKINS_API_TOKEN:token,
    JENKINS_MODE:'api', testPassword:password
  ]).getBytes('UTF-8'))
  file.setReadable(false, false)
  file.setReadable(true, true)
  file.setWritable(false, false)
  file.setWritable(true, true)
}
