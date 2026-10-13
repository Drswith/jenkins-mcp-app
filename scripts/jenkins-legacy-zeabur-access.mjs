import { execFileSync } from 'node:child_process';
import { chmod, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const [serviceID, environmentID] = process.argv.slice(2);
if (![serviceID, environmentID].every(x => /^[a-f0-9]{24}$/.test(x || ''))) throw new Error('Usage: node scripts/jenkins-legacy-zeabur-access.mjs <service-id> <environment-id>');
let access;
try {
  const raw = execFileSync('npx', ['zeabur@latest','service','exec','-i=false','--id',serviceID,'--env-id',environmentID,'--','cat','/var/jenkins_home/legacy-test-credentials.json'], {encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:60000});
  access=JSON.parse(raw.match(/\{[\s\S]*\}/)?.[0] || '{}');
  if (access.JENKINS_URL !== 'https://jenkins-legacy-drs-sg.zeabur.app/' || access.JENKINS_MODE !== 'api' || !access.JENKINS_USER || !access.JENKINS_API_TOKEN || !access.testPassword) throw new Error();
} catch { throw new Error('Legacy credentials could not be exported; check readiness. Sensitive output has been withheld.'); }
const directory=resolve('.local/jenkins-legacy');await mkdir(directory,{recursive:true,mode:0o700});
const {testPassword,...config}=access;
for(const [name,value] of [['jenkins-access.json',access],['config.json',config]]){const file=resolve(directory,name);await writeFile(file,JSON.stringify(value,null,2)+'\n',{mode:0o600});await chmod(file,0o600);console.log(file);}
