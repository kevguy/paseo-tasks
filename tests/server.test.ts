import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, writeFile, symlink, rm } from "node:fs/promises";
import { resolve, join } from "node:path";
import { getList, getDetail, getArtifact } from "../server/store";
import { handoff, guards, hash, records } from "../server/reader";
import { references, recordedRun, readBounded, safePath } from "../server/files";
import { configSchema } from "../server/config";
const root = resolve(".validation/server-tests");
const config = { wrapper: "/opt/tools/claude-tools", vaultRoot: root, artifactRoots: [join(root, "archives")], ledgerPath: join(root, "ledger.jsonl"), hostLabel: "test-host", pathDirectories: [] };
const task = { id: "test-1", title: "Example", status: "in_progress", priority: 1, owner: "Operator", updated_at: "2026-11-20T12:00:00Z" };
const runId = "hr-20261120T163638Z-9ca230ad7881";
const opts = (raw: unknown = task) => ({ config, run: async (args: string[]) => args[0] === "where" ? { database_path: "/private/beads.db" } : [raw] });
test("configuration requires fixed absolute wrapper and rejects extra settings", () => { assert.equal(configSchema.parse(config).wrapper, config.wrapper); assert.throws(() => configSchema.parse({ ...config, wrapper: "/bin/sh" })); assert.throws(() => configSchema.parse({ ...config, launch: "run" })); });
test("read commands always carry all three write guards", () => { assert.deepEqual(guards, ["--json", "--readonly", "--no-auto-import", "--no-auto-flush"]); });
test("list is bounded, filters with fixed arguments and fingerprints the observed records", async () => {
 const calls: string[][] = []; const raw = Array.from({length:201}, (_, i) => ({...task, id:`test-${i}`}));
 const result = await getList("in_progress", "Operator", { config, run: async args => { calls.push(args); return args[0] === "where" ? { database_path:"/private/beads.db" } : raw; } });
 assert.equal(result.available, true); assert.equal(result.limited, true); assert.equal(result.tasks.length, 200); assert.equal(result.source.revision, hash(JSON.stringify(raw))); assert.deepEqual(calls[1], ["list", "--sort", "priority", "--limit", "201", "--status", "in_progress"]);
 assert.match(result.source.warnings.join(" "), /by priority/);
});
test("exact ID search reaches tasks outside the bounded priority list and respects status", async () => {
 const calls: string[][]=[];
 const options={config,run:async(args:string[])=>{calls.push(args);if(args[0]==="where")return {database_path:"/private/beads.db"};if(args.includes("--id"))return [{...task,priority:4}];throw Error("The capped list must not hide an exact match");}};
 const result=await getList("all",task.id,options);
 assert.equal(result.available,true);assert.equal(result.tasks[0].id,task.id);assert.equal(result.limited,false);assert.deepEqual(calls[1],["list","--id",task.id,"--limit","2","--all"]);assert.equal(calls.length,2);
 calls.length=0;await getList("closed",task.id,options);assert.deepEqual(calls[1],["list","--id",task.id,"--limit","2","--status","closed"]);
 calls.length=0;await getList("active",task.id,options);assert.deepEqual(calls[1],["list","--id",task.id,"--limit","2"]);
});
test("hyphenated text and mismatched exact reads fall back to bounded search without exposing errors",async()=>{
 for(const mismatch of [false,true]) {
  const options={config,run:async(args:string[])=>{if(args[0]==="where")return {database_path:"/private/beads.db"};if(args.includes("--id")){if(mismatch)return [{...task,id:"other-1"}];throw Error("private failure");}return [{...task,title:"long-running job"}];}};
  const result=await getList("all","long-running",options);
  assert.equal(result.available,true);assert.equal(result.tasks.length,1);assert.equal(result.tasks[0].id,task.id);assert.equal(JSON.stringify(result).includes("private failure"),false);
 }
});
test("errors, unsupported rows and absent authority fail closed without leaking CLI text", async () => {
 const result = await getList("all", "", { config, run: async () => { throw Error("secret-token-private-output"); } });
 assert.equal(result.available,false); assert.equal(JSON.stringify(result).includes("secret-token"),false);
 assert.equal((await getList("all", "", opts({...task, priority:7}))).available, false);
 assert.throws(() => records([{...task, id:"--help"}]));
});
test("handoffs select newest session-end comment by timestamp, not array position", () => {
 const comments = [{id:4, created_at:"2026-11-20", text:"## Session End\nnew"}, {id:8, created_at:"2026-11-21", text:"ordinary update"}, {id:1, created_at:"2026-11-18", text:"## Session End\nold"}];
 assert.equal(handoff({...task,comments})?.text,"## Session End\nnew"); assert.equal(handoff({...task,notes:"fallback"})?.kind,"notes"); assert.equal(handoff(task),null);
});
test("malformed comment metadata cannot hide a valid session-end handoff",async()=>{
 const result=await getDetail(task.id,opts({...task,comments:[
  {id:1,created_at:"2026-11-20T12:00:00Z",text:"## Session End\nContinue safely."},
  {id:{toString:null},created_at:{toString:null},text:"## Session End\nMalformed metadata."},
  {id:{toString:null},created_at:"2026-11-20T12:00:00Z",text:"ordinary malformed ID"},
 ]}));
 assert.equal(result.available,true);assert.equal(result.handoff?.text,"## Session End\nContinue safely.");assert.equal(result.handoff?.kind,"session-end");
});
test("wrong task ID cannot expose another task; malicious ID never executes a read", async () => {
 assert.equal((await getDetail("test-2",opts())).available,false);
 let called=false; const detail=await getDetail("--help",{config,run:async()=>{called=true;return [];}}); assert.equal(called,false); assert.equal(detail.available,false);
});
test("detail exposes recorded context with revision and unknown run honestly", async () => {
 const result=await getDetail(task.id,opts({...task,notes:"notes", acceptance_criteria:"criteria",dependencies:[{id:"dep-1",title:"dependency",status:"closed",dependency_type:"blocks"}],comments:[{id:1,created_at:"2026-11-20",text:`## Session End\n${runId}`}]}));
 assert.equal(result.available,true); assert.equal(result.acceptance,"criteria"); assert.equal(result.dependencies[0].relationship,"blocks"); assert.equal(result.run?.found,false); assert.match(result.continuation,/not an instruction to launch/); assert.match(result.continuation,/Sync at that startup: unknown/);
});
test("detail ignores malformed dependency and dependent entries while preserving valid relationships", async () => {
 const result=await getDetail(task.id,opts({...task,
  dependencies:[null,"not-an-object",[],{id:"dep-valid",title:"Required parent",status:"open",dependency_type:"blocks"},{id:"dep-malformed-type",title:"Unrecognized relation",status:"open",dependency_type:{toString:null}}],
  dependents:[null,42,[],{id:"dependent-valid",title:"Child task",status:"in_progress",type:"parent"},{id:"dependent-malformed-type",title:"Unrecognized child relation",status:"open",dependency_type:{toString:null}}],
 }));
 assert.equal(result.available,true);
 assert.deepEqual(result.dependencies,[
  {id:"dep-valid",title:"Required parent",status:"open",relationship:"blocks"},
  {id:"dep-malformed-type",title:"Unrecognized relation",status:"open",relationship:"related"},
  {id:"dependent-valid",title:"Child task",status:"in_progress",relationship:"dependent: parent"},
  {id:"dependent-malformed-type",title:"Unrecognized child relation",status:"open",relationship:"dependent: related"},
 ]);
});
test("long task text is bounded and warns instead of silently implying full context",async()=>{const result=await getDetail(task.id,opts({...task,notes:"x".repeat(70000)}));assert.equal(result.available,true);assert.equal(result.notes.length,65536);assert.ok(result.source.warnings.length);assert.ok(result.continuation.length<=180000);});
test("run linkage requires one explicit ID and a matching session-start; no newest-run inference",async()=>{
 await mkdir(root,{recursive:true});await writeFile(config.ledgerPath,JSON.stringify({event:"session-start",harness_run_id:runId,project_dir:"/work/repo",branch:"main",sync_status:"updated",timestamp:"2026-11-20"})+"\n");
 try {assert.equal((await recordedRun(config,runId))?.branch,"main");assert.equal(await recordedRun(config,"no explicit run"),null);assert.equal(await recordedRun(config,runId+" hr-20261120T163638Z-aaaaaaaaaaaa"),null);} finally{await rm(config.ledgerPath);}
});
test("run linkage skips malformed ledger rows after a matching session-start",async()=>{
 await mkdir(root,{recursive:true});
 const start=JSON.stringify({event:"session-start",harness_run_id:runId,project_dir:"/work/repo",branch:"main",sync_status:"updated",timestamp:"2026-11-20"});
 await writeFile(config.ledgerPath,[start,"null","[]","42",JSON.stringify("scalar"),"{malformed"].join("\n")+"\n");
 try {assert.deepEqual(await recordedRun(config,runId),{id:runId,found:true,project:"/work/repo",branch:"main",syncStatus:"updated",timestamp:"2026-11-20"});} finally{await rm(config.ledgerPath);}
});
test("artifact preview permits only references in the selected task and hashes exact content",async()=>{
 await mkdir(config.artifactRoots[0],{recursive:true});const path=join(config.artifactRoots[0],"proof.md");await writeFile(path,"test evidence\n");
 const options=opts({...task,notes:`[Proof](${path}:12)`});const detail=await getDetail(task.id,options);assert.equal(detail.references.length,1);
 const result=await getArtifact(task.id,detail.references[0].id,options);assert.equal(result.available,true);assert.equal(result.sha256,hash("test evidence\n"));assert.equal(result.text,"test evidence\n");assert.equal((await getArtifact(task.id,"a".repeat(24),options)).available,false);
});
test("artifact traversal, secret paths, outside symlinks, binary and oversized files are rejected",async()=>{
 await mkdir(config.artifactRoots[0],{recursive:true});const outside=join(root,"outside.md");await writeFile(outside,"outside");const link=join(config.artifactRoots[0],"escape.md");await rm(link,{force:true});await symlink(outside,link);
 assert.equal(references(config,`${config.artifactRoots[0]}/../outside.md`).length,0);assert.equal(references(config,`${config.artifactRoots[0]}/secrets/key.json`).length,0);await assert.rejects(()=>safePath(config,link));await assert.rejects(()=>safePath(config,outside));
 const binary=join(config.artifactRoots[0],"binary.txt");await writeFile(binary,Buffer.from([0,1]));await assert.rejects(()=>readBounded(binary));const big=join(config.artifactRoots[0],"big.txt");await writeFile(big,"x".repeat(262145));await assert.rejects(()=>readBounded(big));
});
