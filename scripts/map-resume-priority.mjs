import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { questions as legacyQuestions } from "../data/questions.js";

const defaultDatabasePath=new URL("../data/interview_bank.sqlite",import.meta.url);
const defaultFocusPath=new URL("../data/resume-focus.json",import.meta.url);
const reviewBatch="resume-priority-v3";
const rank=new Map([["P0",3],["P1",2],["P2",1]]);

export const p0Representatives=[
  {topic:"简历真实性与个人贡献边界",sourceId:"src-0950",relation:"adjacent",detail:"邻近基础能力：数据量与指标口径题可用于追问证据、个人贡献和可复现性"},
  {topic:"求职定位与项目叙事",sourceId:"src-1103",relation:"adjacent",detail:"邻近基础能力：Agent 与模型边界可用于检验候选人的岗位叙事是否建立在真实工程能力上"},
  {topic:"Java 后端实习与秒杀链路",sourceId:"src-0423",relation:"exact",detail:"秒杀系统设计直接覆盖限流、库存、幂等、消息与补偿"},
  {topic:"RAG 全链路与质量评测",sourceId:"src-1162",relation:"exact",detail:"完整 RAG 工作流直接覆盖入库、检索、生成与故障定位"},
  {topic:"Agent 与 Multi-Agent 取舍",sourceId:"src-1121",relation:"exact",detail:"Agent 与 Workflow 的比较直接覆盖动态决策和固定流程边界"},
  {topic:"Tool Calling 与 MCP 安全",sourceId:"src-1197",relation:"adjacent",detail:"邻近基础能力：MCP 与 Function Calling 边界是进一步审查鉴权、参数校验和副作用控制的前提"},
  {topic:"智能运维 Agent 的证据链",sourceId:"src-1118",relation:"adjacent",detail:"邻近基础能力：任务幻觉题直接检验是否先执行工具并保留证据再下结论；题库没有 Prometheus 精确题"},
  {topic:"智能求职 Agent 的业务闭环",sourceId:"src-1114",relation:"adjacent",detail:"邻近基础能力：Agent 组件与状态流转可支撑业务闭环追问；抓取库没有求职业务精确题"},
  {topic:"大模型应用故障与安全",sourceId:"src-1146",relation:"exact",detail:"幻觉成因与缓解直接覆盖应用故障边界"},
];

export const manualAssignments=[
  ["src-0950","P0",["MySQL"],["数据量"],"简历真实性与个人贡献边界"],
  ["src-1103","P0",["Agent"],["Agent"],"求职定位与项目叙事","llm-01"],
  ["src-0423","P0",["系统设计"],["秒杀"],"Java 后端实习与秒杀链路","resume-05"],
  ["src-1162","P0",["RAG"],["RAG"],"RAG 全链路与质量评测","rag-01"],
  ["src-1121","P0",["Agent"],["Agent","Workflow"],"Agent 与 Multi-Agent 取舍","agent-01"],
  ["src-1197","P0",["LLM工具调用"],["MCP","Function Calling"],"Tool Calling 与 MCP 安全"],
  ["src-1118","P0",["Agent"],["任务幻觉","工具"],"智能运维 Agent 的证据链"],
  ["src-1114","P0",["Agent"],["Agent","架构"],"智能求职 Agent 的业务闭环"],
  ["src-1146","P0",["LLM工程"],["幻觉"],"大模型应用故障与安全","llm-06"],
  ["src-0763","P1",["Java基础"],["线程池"],"Java 并发与流式接口"],
  ["src-0768","P1",["Java基础"],["synchronized","lock"],"Java 并发与流式接口"],
  ["src-0869","P1",["MySQL"],["MVCC"],"MySQL 数据建模与事务","mysql-04"],
  ["src-0937","P1",["MySQL"],["MVCC"],"MySQL 数据建模与事务"],
  ["src-0463","P1",["消息队列"],["RocketMQ","重复消费"],"Redis 与消息最终一致性","java-06"],
  ["src-1188","P1",["LLM工具调用"],["SSE"],"SSE 协议与异常收尾","net-07"],
  ["src-1171","P0",["RAG"],["量化","RAG"],"RAG 全链路与质量评测","rag-07"],
  ["src-1172","P1",["RAG"],["RAG","更新"],"Milvus 与向量数据生命周期"],
  ["src-1104","P0",["Agent"],["Multi-Agent"],"Agent 与 Multi-Agent 取舍"],
  ["src-1117","P0",["Agent"],["Multi-Agent","超时"],"Agent 与 Multi-Agent 取舍"],
  ["src-1195","P1",["LLM工具调用"],["MCP"],"Tool Calling 与 MCP 安全","tool-03"],
  ["src-1179","P1",["RAG"],["Embedding","RAG"],"Milvus 与向量数据生命周期","rag-03"],
  ["src-1183","P1",["LLM工具调用"],["Function Calling"],"Tool Calling 与 MCP 安全","tool-01"],
  ["src-1185","P1",["LLM工具调用"],["Function Calling","MCP","Skill"],"Tool Calling 与 MCP 安全","tool-04"],
].map(([sourceId,priority,modules,requiredAny,topic,legacyId])=>({sourceId,priority,modules,requiredAny,topic,...(legacyId?{legacyId}:{})}));

const strictRules=[
  {topic:"RAG 全链路与质量评测",modules:["RAG"],any:["切片","召回","检索","评测","幻觉","query","rag"],cap:12},
  {topic:"Agent 与 Multi-Agent 取舍",modules:["Agent"],any:["multi-agent","workflow","planner","executor","重规划","协作","状态"],cap:10},
  {topic:"Tool Calling 与 MCP 安全",modules:["LLM工具调用"],any:["mcp","function calling","工具调用","schema","权限"],cap:9},
  {topic:"大模型应用故障与安全",modules:["LLM工程"],any:["幻觉","prompt injection","提示词注入","越狱","限流","重试","降级","api key"],cap:7},
  {topic:"Java 并发与流式接口",modules:["Java基础","Java并发"],any:["线程池","completablefuture","synchronized","lock","aqs"],cap:7},
  {topic:"Spring Boot 请求链路与工程规范",modules:["Spring"],any:["事务","controller","自动配置","参数校验","异常"],cap:7},
  {topic:"MySQL 数据建模与事务",modules:["MySQL"],any:["mvcc","联合索引","唯一索引","分页","事务"],cap:8},
  {topic:"Redis 与消息最终一致性",modules:["Redis","消息队列"],any:["lua","一致性","重复消费","死信","补偿","事务消息"],cap:8},
  {topic:"Transformer 与模型参数基础",modules:["LLM工程"],any:["self-attention","causal mask","kv cache","temperature","top-p","上下文窗口","tokenization"],cap:7},
];

function parseArguments(args){const out={databasePath:fileURLToPath(defaultDatabasePath),focusPath:fileURLToPath(defaultFocusPath)};for(let i=0;i<args.length;i++){const a=args[i],v=args[i+1];if(!["--database","--focus"].includes(a))throw Error(`unknown argument: ${a}`);if(!v||v.startsWith("--"))throw Error(`missing value for ${a}`);out[a==="--database"?"databasePath":"focusPath"]=resolve(v);i++}return out}
function requireFile(path,label){if(!existsSync(path)||!statSync(path).isFile())throw Error(`${label} does not exist: ${path}`)}
const normalize=x=>String(x??"").normalize("NFKC").toLocaleLowerCase("zh-CN");
const titleKey=x=>normalize(x).replace(/[\p{P}\p{S}\s]/gu,"").replace(/什么|怎么|如何|说说|讲讲|介绍|一下|原理/g,"");
const isNearDuplicate=(key,seen)=>[...seen].some(old=>key===old||(key.length>=5&&old.length>=5&&(key.includes(old)||old.includes(key))));
function validateFocus(c){if(!Array.isArray(c?.priorityTopics)||!c.priorityTopics.length)throw Error("focus configuration must contain priorityTopics");for(const t of c.priorityTopics)if(!t.module||!rank.has(t.priority)||!Array.isArray(t.keywords)||!t.keywords.length||!t.reason)throw Error(`invalid priority topic: ${t?.module??"<unknown>"}`)}
function add(map,row,priority,reason){const old=map.get(row.id);if(!old)map.set(row.id,{priority,reasons:[reason]});else{if(rank.get(priority)>rank.get(old.priority))old.priority=priority;if(!old.reasons.includes(reason))old.reasons.push(reason)}}

export function mapResumePriorities(databasePath,focusPath){requireFile(databasePath,"database");requireFile(focusPath,"focus configuration");const config=JSON.parse(readFileSync(focusPath,"utf8"));validateFocus(config);const topics=new Map(config.priorityTopics.map(t=>[t.module,t]));const db=new DatabaseSync(databasePath);try{db.exec("PRAGMA foreign_keys=ON");const rows=db.prepare(`SELECT q.id,q.source_id,q.question,q.original_title,q.module,q.submodule,CASE WHEN a.id IS NULL THEN 0 ELSE 1 END has_answer FROM questions q LEFT JOIN answers a ON a.question_id=q.id ORDER BY q.id`).all().map(r=>({...r,text:normalize(`${r.question} ${r.original_title}`)}));const bySource=new Map(rows.map(r=>[r.source_id,r])),assignments=new Map(),usedTitleKeys=new Set();
    for(const item of manualAssignments){const row=bySource.get(item.sourceId),topic=topics.get(item.topic);if(!row||!row.has_answer||!topic)continue;if(!item.modules.includes(row.module)||!item.requiredAny.some(t=>row.text.includes(normalize(t))))throw Error(`invalid manual mapping: ${item.sourceId}`);const rep=p0Representatives.find(p=>p.sourceId===item.sourceId);add(assignments,row,item.priority,`${item.topic}：人工确认；${rep?.detail??`标题明确包含 ${item.requiredAny.join("/")}，且模块为 ${row.module}`}`);usedTitleKeys.add(titleKey(row.question))}
    for(const rule of strictRules){const topic=topics.get(rule.topic);if(!topic)continue;let taken=0;for(const row of rows){if(taken>=rule.cap)break;if(assignments.has(row.id)||!row.has_answer||!rule.modules.includes(row.module))continue;const hits=rule.any.filter(t=>row.text.includes(normalize(t)));if(!hits.length)continue;const key=titleKey(row.question);if(!key||isNearDuplicate(key,usedTitleKeys))continue;add(assignments,row,topic.priority,`${rule.topic}：严格主题规则；限定模块 ${row.module}，标题明确命中 ${hits.join("、")}`);usedTitleKeys.add(key);taken++}}
    if(assignments.size===0)throw Error("no trustworthy priority mappings");const mappedLegacy=new Set(manualAssignments.flatMap(x=>x.legacyId?[x.legacyId]:[]));const allLegacy=legacyQuestions.filter(q=>q.resumeFocus).map(q=>q.id);const unmapped=allLegacy.filter(id=>!mappedLegacy.has(id));
    const existingV3=new Map(db.prepare("SELECT r.question_id,r.status,r.notes,r.reviewed_at,a.review_status FROM answer_reviews r JOIN answers a ON a.question_id=r.question_id WHERE r.batch=?").all(reviewBatch).map(r=>[r.question_id,r]));const reviewable=new Set([...assignments].filter(([,a])=>["P0","P1"].includes(a.priority)).map(([id])=>id));
    const clear=db.prepare("UPDATE questions SET resume_focus=0,priority=NULL,resume_reason=''");const apply=db.prepare("UPDATE questions SET resume_focus=1,priority=?,resume_reason=? WHERE id=?");const insert=db.prepare("INSERT INTO answer_reviews(question_id,batch,status,notes,reviewed_at) VALUES(?,?,'pending',?,NULL)");db.exec("BEGIN IMMEDIATE");try{clear.run();db.prepare("UPDATE answers SET review_status='draft' WHERE question_id IN (SELECT question_id FROM answer_reviews WHERE batch='resume-priority-v2')").run();db.prepare("DELETE FROM answer_reviews WHERE batch='resume-priority-v2'").run();for(const [id] of existingV3)if(!reviewable.has(id)){db.prepare("UPDATE answers SET review_status='draft' WHERE question_id=?").run(id);db.prepare("DELETE FROM answer_reviews WHERE question_id=? AND batch=?").run(id,reviewBatch)}for(const [id,a] of assignments){const reason=a.reasons.join("\n");apply.run(a.priority,reason,id);if(reviewable.has(id)&&!existingV3.has(id))insert.run(id,reviewBatch,`待审关注点：核对答案是否准确覆盖“${reason.split("：")[0]}”所需机制、边界与项目真实性，不得把邻近能力冒充项目实作。`)}db.exec("COMMIT")}catch(e){db.exec("ROLLBACK");throw e}
    return {counts:Object.fromEntries(db.prepare("SELECT priority,COUNT(*) count FROM questions WHERE priority IS NOT NULL GROUP BY priority").all().map(r=>[r.priority,r.count])),unmappedLegacyIds:unmapped};
  }finally{db.close()}}

const isMain=process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url;if(isMain){try{const o=parseArguments(process.argv.slice(2)),r=mapResumePriorities(o.databasePath,o.focusPath);console.log(`resume priorities mapped: ${JSON.stringify(r.counts)}`);const mapped=legacyQuestions.filter(q=>q.resumeFocus&&!r.unmappedLegacyIds.includes(q.id)).map(q=>q.id);console.log(`mapped legacy IDs: ${mapped.join(",")||"none"}`);console.log(`unmapped legacy IDs: ${r.unmappedLegacyIds.join(",")||"none"}`)}catch(e){console.error(e.message);process.exitCode=1}}
