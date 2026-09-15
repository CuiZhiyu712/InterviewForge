import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { manualAssignments, p0Representatives } from "../scripts/map-resume-priority.mjs";

const root=resolve(import.meta.dirname,".."), temp=mkdtempSync(join(tmpdir(),"interview-priority-"));
const dbPath=join(temp,"bank.sqlite"), emptyFocus=join(temp,"empty.json");
const script=name=>resolve(root,"scripts",name);
function run(file,args,status=0){const r=spawnSync(process.execPath,["--disable-warning=ExperimentalWarning",file,...args],{cwd:root,encoding:"utf8"});assert.equal(r.status,status,`${file} exited ${r.status}:\n${r.stdout}\n${r.stderr}`);return r}
function mapper(focus=resolve(root,"data/resume-focus.json"),status=0){return run(script("map-resume-priority.mjs"),["--database",dbPath,"--focus",focus],status)}

try {
  run(script("create-database.mjs"),["--source",resolve(root,"data/source-index.json"),"--output",dbPath]);
  run(script("import-answer-batches.mjs"),["--database",dbPath,"--batches",resolve(root,"data/answer-batches")]);
  const setup=new DatabaseSync(dbPath);
  setup.prepare("UPDATE questions SET resume_focus=1,priority='P0',resume_reason='dirty mapping' WHERE source_id='src-0025'").run();
  setup.prepare("UPDATE answers SET review_status='priority-reviewed' WHERE question_id=(SELECT id FROM questions WHERE source_id='src-0025')").run();
  setup.prepare("INSERT INTO answer_reviews(question_id,batch,status,notes,reviewed_at) SELECT id,'resume-priority-v2','passed','dirty','2020-01-01' FROM questions WHERE source_id='src-0025'").run();setup.close();
  assert.match(mapper().stdout,/unmapped legacy IDs:/);
  const db=new DatabaseSync(dbPath,{readOnly:true});
  try {
    const count=db.prepare("SELECT COUNT(*) count FROM questions WHERE resume_focus=1").get().count;
    assert.ok(count>=60&&count<=120,`expected 60-120 focused questions, got ${count}`);
    const ids=manualAssignments.map(x=>x.sourceId);assert.equal(new Set(ids).size,ids.length,"manual source IDs must be unique");
    for(const a of manualAssignments){const r=db.prepare("SELECT question,original_title,module,priority,resume_reason FROM questions WHERE source_id=?").get(a.sourceId);assert.ok(r,`missing ${a.sourceId}`);assert.equal(r.priority,a.priority);assert.ok(a.modules.includes(r.module),`${a.sourceId} module`);const title=`${r.question} ${r.original_title}`.toLocaleLowerCase("zh-CN");assert.ok(a.requiredAny.some(t=>title.includes(t.toLocaleLowerCase("zh-CN"))),`${a.sourceId} token`);assert.match(r.resume_reason,/人工确认/)}
    assert.equal(p0Representatives.length,9);
    for(const p of p0Representatives){const r=db.prepare("SELECT priority,resume_reason FROM questions WHERE source_id=?").get(p.sourceId);assert.equal(r.priority,"P0",p.topic);assert.match(r.resume_reason,new RegExp(p.topic));if(p.relation==="adjacent")assert.match(r.resume_reason,/邻近基础能力/)}
    for(const id of ["src-0025","src-0041","src-0045","src-0049","src-0219","src-0306","src-0607","src-0918"]){const r=db.prepare("SELECT resume_focus,priority,resume_reason FROM questions WHERE source_id=?").get(id);assert.deepEqual({...r},{resume_focus:0,priority:null,resume_reason:""},`${id} negative`)}
    assert.equal(db.prepare("SELECT COUNT(*) count FROM answers WHERE review_status<>'draft'").get().count,0,"no automatic reviewed status");
    assert.equal(db.prepare("SELECT COUNT(*) count FROM answer_reviews WHERE status<>'pending'").get().count,0,"no automatic passed review");
    assert.equal(db.prepare("SELECT COUNT(*) count FROM answer_reviews WHERE batch='resume-priority-v2'").get().count,0,"legacy auto-passed mapper reviews must be removed");
    assert.equal(db.prepare("SELECT COUNT(*) count FROM answer_reviews WHERE batch='resume-priority-v3' AND length(trim(notes))<12").get().count,0,"specific pending notes");
    assert.equal(db.prepare("SELECT COUNT(*) count FROM questions WHERE resume_focus=0 AND (priority IS NOT NULL OR resume_reason<>'')").get().count,0);
    const first={q:db.prepare("SELECT id,resume_focus,priority,resume_reason FROM questions ORDER BY id").all(),a:db.prepare("SELECT question_id,review_status FROM answers ORDER BY question_id").all(),r:db.prepare("SELECT question_id,batch,status,notes,reviewed_at FROM answer_reviews WHERE batch='resume-priority-v3' ORDER BY question_id").all()};db.close();mapper();const db2=new DatabaseSync(dbPath,{readOnly:true});try{assert.deepEqual({q:db2.prepare("SELECT id,resume_focus,priority,resume_reason FROM questions ORDER BY id").all(),a:db2.prepare("SELECT question_id,review_status FROM answers ORDER BY question_id").all(),r:db2.prepare("SELECT question_id,batch,status,notes,reviewed_at FROM answer_reviews WHERE batch='resume-priority-v3' ORDER BY question_id").all()},first)}finally{db2.close()}
  } finally {if(db.isOpen)db.close()}
  writeFileSync(emptyFocus,JSON.stringify({priorityTopics:[{module:"不存在主题",keywords:["绝不命中"],reason:"负例",priority:"P2"}]}));assert.match(mapper(emptyFocus,1).stderr,/no trustworthy priority mappings/i);
} finally {rmSync(temp,{recursive:true,force:true})}
console.log("resume priority mapping tests passed");
