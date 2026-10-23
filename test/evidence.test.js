import test from "node:test";
import assert from "node:assert/strict";
import { logEvidence, prepareParameters, changesSinceSuccess } from "../src/evidence.js";
import { sendPrompt, promptTarget } from "../ui/src/host.js";

test("log snippets preserve original line numbers and blank lines", () => {
  assert.deepEqual(logEvidence("ok\n\nERROR broken\nend\n", 3).lines.map(({number, text}) => [number, text]), [[2, ""], [3, "ERROR broken"], [4, "end"]]);
  assert.equal(logEvidence("a\nb\nc", 1).lines[0].number, 3);
  assert.equal(logEvidence("", 3).lines.length, 0);
});
test("confirmation merges defaults and refuses secrets, unknown names and invalid choices", () => {
  const defs = [{name:"FLAG",type:"boolean",defaultValue:false}, {name:"ENV",type:"choice",choices:["dev","prod"],defaultValue:"dev"}, {name:"TOKEN",type:"password",sensitive:true,defaultValue:null}];
  const result = prepareParameters(defs, { ENV: "prod" });
  assert.equal(result[0].value, false); assert.equal(result[1].changed, true); assert.equal(result[2].blocked, true);
  for (const values of [{ ENV: "bad" }, { FLAG: "false" }, { TOKEN: "private" }, { bad: "x" }]) assert.throws(() => prepareParameters(defs, values));
});
test("changes include intervening failures, deduplicate commits, and never use a later success", () => {
  const item = {commitId:"abc",msg:"fix",author:{fullName:"Ada"}};
  const rows = [{number:9,result:"SUCCESS"},{number:8,result:"FAILURE",changeSets:[{items:[item]}]},{number:7,result:"FAILURE",changeSet:{items:[item]}},{number:6,result:"SUCCESS"}];
  const result = changesSinceSuccess(rows, 8);
  assert.equal(result.baselineBuildNumber,6); assert.equal(result.commits.length,1);
  assert.equal(changesSinceSuccess(rows.slice(0,3),8).available,false);
});
test("messages feature-detect new conversations and never retry an ambiguous send", async () => {
  let calls = 0;
  const bridge = { getHostCapabilities:()=>({experimental:{"openai/message":{}},message:{text:{}}}),getHostContext:()=>({platform:"desktop"}),sendMessage:async (params)=>{calls++;assert.equal(params._meta["openai/message"].target,"new");return {};} };
  assert.equal(await sendPrompt(bridge,"test",true),"new"); assert.equal(calls,1);
  bridge.getHostContext=()=>({platform:"mobile"}); assert.equal(promptTarget(bridge,true),"active");
  bridge.getHostCapabilities=()=>({}); await assert.rejects(sendPrompt(bridge,"test"),/不支持/);assert.equal(calls,1);
});
