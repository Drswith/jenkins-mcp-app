import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

// The mounted files are shared with local Compose; do not duplicate their contents.
const fixture = resolve("test/local-jenkins");
const config = async (path, file) => ({
  path, permission: 420, envsubst: false,
  template: await readFile(resolve(fixture, file), "utf8"),
});
const readme = "Jenkins MCP test environment using official Jenkins and Gitea images, SQLite, mounted bootstrap files and persistent data. Jenkins and Gitea are MIT licensed: https://github.com/jenkinsci/jenkins, https://www.jenkins.io/ and https://github.com/go-gitea/gitea. Credentials remain in private files in the data volumes. The sample repository contains disposable test data only.";
const translations = {
  "zh-TW": ["官方 Jenkins 與 Gitea、SQLite 的測試環境。", "Jenkins 網域", "Gitea 網域", "HTTPS 網域前綴", "憑證保存在資料卷的私人檔案中；範例倉庫僅含測試資料。"],
  "zh-CN": ["官方 Jenkins 与 Gitea、SQLite 的测试环境。", "Jenkins 域名", "Gitea 域名", "HTTPS 域名前缀", "凭据保存在数据卷的私人文件中；示例仓库仅含测试数据。"],
  "ja-JP": ["公式 Jenkins と Gitea、SQLite のテスト環境。", "Jenkins ドメイン", "Gitea ドメイン", "HTTPS ドメインの接頭辞", "認証情報はデータボリュームの非公開ファイルに保存します。サンプルにはテストデータのみを含みます。"],
  "es-ES": ["Entorno de prueba con Jenkins y Gitea oficiales y SQLite.", "Dominio de Jenkins", "Dominio de Gitea", "Prefijo del dominio HTTPS", "Las credenciales se guardan en archivos privados de los volúmenes. El repositorio contiene solo datos de prueba."],
  "id-ID": ["Lingkungan pengujian dengan Jenkins dan Gitea resmi serta SQLite.", "Domain Jenkins", "Domain Gitea", "Awalan domain HTTPS", "Kredensial disimpan dalam berkas privat di volume data. Repositori hanya berisi data pengujian."],
};
const template = {
  apiVersion: "zeabur.com/v1", kind: "Template",
  metadata: { name: "Jenkins MCP test" },
  spec: {
    description: "Official Jenkins with mounted MCP/Git plugin setup and lightweight Gitea with SQLite.",
    tags: ["CI", "Development"], readme,
    variables: [
      { key: "PUBLIC_DOMAIN", type: "DOMAIN", name: "Jenkins domain", description: "HTTPS domain prefix for the test controller." },
      { key: "GITEA_DOMAIN", type: "DOMAIN", name: "Gitea domain", description: "HTTPS domain prefix for Git hosting." },
    ],
    services: [
      {
        name: "gitea", template: "PREBUILT_V2", domainKey: "GITEA_DOMAIN",
        spec: {
          source: { image: "docker.gitea.com/gitea:28.1.0-rootless@sha256:b1a90409ae9afcd5a5725404c3639da7245248848b99e35332968891290b953e", runAsUserID: 0, command: ["/usr/bin/dumb-init", "--", "/bin/su", "git", "-s", "/bin/sh", "-c", "exec /usr/local/bin/docker-entrypoint.sh"] },
          ports: [{ id: "web", port: 3000, type: "HTTP" }],
          portForwarding: { enabled: false },
          healthCheck: { type: "HTTP", port: "web", http: { path: "/api/healthz" } },
          volumes: [{ id: "gitea-data", dir: "/var/lib/gitea" }, { id: "gitea-config", dir: "/etc/gitea" }],
          init: [{ id: "volume-permissions", image: "alpine:3.22.6", command: ["sh", "-c", "chown -R 1000:1000 /var/lib/gitea /etc/gitea"], volumes: [{ id: "gitea-data", mountPath: "/var/lib/gitea" }, { id: "gitea-config", mountPath: "/etc/gitea" }] }],
          configs: [{ path: "/opt/gitea-bootstrap/seed.sh", permission: 420, envsubst: false, template: await readFile(resolve("test/zeabur/gitea-seed.sh"), "utf8") }],
          env: {
            GITEA__database__DB_TYPE: { default: "sqlite3" },
            GITEA__security__INSTALL_LOCK: { default: "true" },
            GITEA__service__DISABLE_REGISTRATION: { default: "true" },
            GITEA__server__ROOT_URL: { default: "https://${ZEABUR_WEB_DOMAIN}/" },
            GITEA__server__DISABLE_SSH: { default: "true" },
            GITEA__actions__ENABLED: { default: "false" },
            GITEA_SCM_URL: { default: "http://${CONTAINER_HOSTNAME}:3000/codex-test/sample.git", expose: true },
          },
        },
      },
      {
        name: "jenkins", template: "PREBUILT_V2", dependencies: ["gitea"], domainKey: "PUBLIC_DOMAIN",
        spec: {
          source: { image: "jenkins/jenkins:2.580.1-jdk21@sha256:a660310e39ade10631f774bacd5219de767dfd08947ea5c32a739b5e5bb382c1", runAsUserID: 0, command: ["/usr/bin/tini", "--", "/usr/sbin/runuser", "-u", "jenkins", "--", "/bin/sh", "/opt/jenkins-bootstrap/start.sh"] },
          ports: [{ id: "web", port: 8080, type: "HTTP" }],
          portForwarding: { enabled: false },
          healthCheck: { type: "HTTP", port: "web", http: { path: "/login" } },
          volumes: [{ id: "jenkins-home", dir: "/var/jenkins_home" }],
          init: [{ id: "volume-permissions", image: "alpine:3.22.6", command: ["sh", "-c", "chown -R 1000:1000 /var/jenkins_home"], volumes: [{ id: "jenkins-home", mountPath: "/var/jenkins_home" }] }],
          configs: [
            await config("/opt/jenkins-bootstrap/start.sh", "start.sh"),
            await config("/opt/jenkins-bootstrap/plugins.txt", "plugins.txt"),
            await config("/opt/jenkins-bootstrap/init.groovy", "init.groovy"),
          ],
          env: {
            JAVA_OPTS: { default: "-Djenkins.install.runSetupWizard=false -Xms128m -Xmx768m" },
            JENKINS_TEST_URL: { default: "https://${ZEABUR_WEB_DOMAIN}/" },
            JENKINS_TEST_SCM_URL: { default: "${GITEA_SCM_URL}" },
          },
        },
      },
    ],
  },
  localization: Object.fromEntries(Object.entries(translations).map(([locale, [description, jenkinsName, giteaName, domainDescription, help]]) => [locale, {
    description, readme: `${description}\n\n${help}\n\nMIT: https://github.com/jenkinsci/jenkins, https://www.jenkins.io/, https://github.com/go-gitea/gitea`,
    variables: [
      { key: "PUBLIC_DOMAIN", name: jenkinsName, description: domainDescription },
      { key: "GITEA_DOMAIN", name: giteaName, description: domainDescription },
    ],
  }])),
};
const output = resolve(process.argv[2] || ".local/jenkins-test/zeabur-template.json");
await mkdir(resolve(output, ".."), { recursive: true });
await writeFile(output, `${JSON.stringify(template, null, 2)}\n`);
console.log(output);
