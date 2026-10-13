import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const config = async name => ({ path:`/opt/jenkins-legacy-bootstrap/${name}`, permission:420, envsubst:false, template:await readFile(resolve('test/legacy-jenkins', name),'utf8') });
const readme = 'Isolated Jenkins 2.263.1 API compatibility fixture, using the official image and mounted pinned plugin bootstrap. Existing Jenkins/Gitea volumes are not shared. Jenkins is MIT licensed: https://github.com/jenkinsci/jenkins and https://www.jenkins.io/. Credentials remain private in the service data volume. This is a synthetic test baseline, not a copy of production.';
const translations={
  'zh-TW':['Jenkins 2.263.1 API 相容測試，使用官方映像與固定外掛。','Jenkins 網域','HTTPS 網域前綴。'],
  'zh-CN':['Jenkins 2.263.1 API 兼容测试，使用官方镜像与固定插件。','Jenkins 域名','HTTPS 域名前缀。'],
  'ja-JP':['公式イメージと固定プラグインを使用した Jenkins 2.263.1 API 互換性テスト。','Jenkins ドメイン','HTTPS ドメインの接頭辞。'],
  'es-ES':['Prueba de compatibilidad API de Jenkins 2.263.1 con imagen oficial y plugins fijados.','Dominio Jenkins','Prefijo del dominio HTTPS.'],
  'id-ID':['Uji kompatibilitas API Jenkins 2.263.1 memakai citra resmi dan plugin versi tetap.','Domain Jenkins','Awalan domain HTTPS.']
};
const template = {
  apiVersion:'zeabur.com/v1',kind:'Template',metadata:{name:'Jenkins 2.263.1 compatibility test'},
  spec:{description:'Official legacy Jenkins with Declarative and Git Parameter API fixtures.',tags:['CI','Development'],readme,
    variables:[{key:'PUBLIC_DOMAIN',type:'DOMAIN',name:'Compatibility Jenkins domain',description:'HTTPS domain prefix.'}],
    services:[{name:'jenkins-legacy',template:'PREBUILT_V2',domainKey:'PUBLIC_DOMAIN',spec:{
      source:{image:'jenkins/jenkins:2.263.1-jdk11@sha256:bde1c86c0e6bac9477b2220cb0d5c33d3a80daa37e995397cd17795525d19a00',runAsUserID:0,command:['/sbin/tini','--','/bin/sh','-c',"if command -v runuser >/dev/null 2>&1; then exec runuser -u jenkins -- /bin/sh /opt/jenkins-legacy-bootstrap/start.sh; else exec su jenkins -s /bin/sh -c 'exec /bin/sh /opt/jenkins-legacy-bootstrap/start.sh'; fi"]},
      ports:[{id:'web',port:8080,type:'HTTP'}],portForwarding:{enabled:false},healthCheck:{type:'HTTP',port:'web',http:{path:'/login'}},
      volumes:[{id:'legacy-jenkins-home',dir:'/var/jenkins_home'}],
      init:[{id:'volume-permissions',image:'alpine:3.22.6',command:['sh','-c','chown -R 1000:1000 /var/jenkins_home'],volumes:[{id:'legacy-jenkins-home',mountPath:'/var/jenkins_home'}]}],
      configs:[await config('start.sh'),await config('init.groovy'),await config('plugins.txt'),await config('plugins-downloads.tsv'),await config('permissions-plugins.tsv')],
      env:{JAVA_OPTS:{default:'-Djenkins.install.runSetupWizard=false -Xms128m -Xmx512m'},JENKINS_TEST_URL:{default:'https://${ZEABUR_WEB_DOMAIN}/'},TZ:{default:'Asia/Shanghai'}}
    }}]
  },
  localization:Object.fromEntries(Object.entries(translations).map(([locale,[description,name,domainDescription]])=>[locale,{description,readme:`${description}\n\nMIT: https://github.com/jenkinsci/jenkins, https://www.jenkins.io/`,variables:[{key:'PUBLIC_DOMAIN',name,description:domainDescription}]}]))
};
const output=resolve(process.argv[2]||'.local/jenkins-legacy/zeabur-template.json');
await mkdir(resolve(output,'..'),{recursive:true});await writeFile(output,JSON.stringify(template,null,2)+'\n');console.log(output);
