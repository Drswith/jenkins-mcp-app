import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, statSync, chmodSync, rmSync, writeFileSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readSettings, callSettingsTool, watchedJobs } from "../src/settings.js";

test("settings persist partial updates privately, independently of credentials", () => {
  const root = mkdtempSync(join(tmpdir(), "jenkins-settings-"));
  const config = { settingsPath: join(root, "config.json.settings.json") };
  const credentials = join(root,"config.json");
  writeFileSync(credentials,"private credential fixture",{mode:0o600});
  try {
    assert.deepEqual(readSettings(config),{watchedJobs:"",evidenceLines:3});
    callSettingsTool(config,"updateJenkinsSettings",{set:{watchedJobs:"folder/job, test, test"}});
    callSettingsTool(config,"updateJenkinsSettings",{set:{evidenceLines:10}});
    assert.deepEqual(readSettings(config),{watchedJobs:"folder/job, test",evidenceLines:10});
    assert.equal(statSync(config.settingsPath).mode & 0o777,0o600);
    assert.equal(readFileSync(credentials,"utf8"),"private credential fixture");
    const before = readFileSync(config.settingsPath,"utf8");
    for (const set of [{url:"https://example.com"},{evidenceLines:0},{evidenceLines:1.5},{watchedJobs:"../bad"},{constructor:"bad"}]) assert.throws(()=>callSettingsTool(config,"updateJenkinsSettings",{set}));
    assert.equal(readFileSync(config.settingsPath,"utf8"),before);
    chmodSync(config.settingsPath,0o644);assert.throws(()=>readSettings(config),/私有/);
    rmSync(config.settingsPath);symlinkSync(credentials,config.settingsPath);assert.throws(()=>readSettings(config),/私有/);
    assert.equal(readFileSync(credentials,"utf8"),"private credential fixture");
  } finally {rmSync(root,{recursive:true,force:true});}
});
test("watch list is bounded and invalid persisted settings are never overwritten", () => {
  assert.throws(()=>watchedJobs(Array.from({length:9},(_,i)=>`job-${i}`).join(",")),/8/);
  const root=mkdtempSync(join(tmpdir(),"jenkins-settings-bad-")),config={settingsPath:join(root,"settings.json")};
  try {
    writeFileSync(config.settingsPath,"broken",{mode:0o600});
    assert.throws(()=>callSettingsTool(config,"updateJenkinsSettings",{set:{evidenceLines:2}}),/无法解析/);
    assert.equal(readFileSync(config.settingsPath,"utf8"),"broken");
  } finally {rmSync(root,{recursive:true,force:true});}
});
