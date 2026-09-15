import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { questions as legacyQuestions } from "../data/questions.js";

const defaultDatabasePath = new URL("../data/interview_bank.sqlite", import.meta.url);
const defaultFocusPath = new URL("../data/resume-focus.json", import.meta.url);
const reviewBatch = "resume-priority-v2";
const priorityRank = new Map([["P0", 3], ["P1", 2], ["P2", 1]]);

const manualLegacyMappings = new Map([
  ["os-07", "src-0519"], ["mysql-01", "src-0941"], ["mysql-03", "src-0935"],
  ["llm-03", "src-1139"], ["llm-06", "src-1170"], ["llm-07", "src-1155"],
  ["rag-02", "src-1177"], ["rag-03", "src-1180"], ["rag-07", "src-1171"], ["agent-07", "src-1137"],
  ["tool-02", "src-1183"], ["tool-07", "src-1192"], ["eng-01", "src-1188"],
  ["eng-02", "src-1088"], ["eng-04", "src-1144"], ["eng-06", "src-1119"],
  ["eng-07", "src-1113"],
  ["java-02", "src-0549"], ["java-03", "src-0184"], ["java-04", "src-0572"],
  ["java-05", "src-0428"], ["java-06", "src-0439"], ["java-07", "src-0067"],
  ["fw-05", "src-1131"], ["resume-01", "src-1114"], ["resume-02", "src-1118"],
  ["resume-03", "src-1179"], ["resume-04", "src-0068"], ["resume-05", "src-0423"],
  ["resume-06", "src-0950"], ["resume-07", "src-1121"], ["resume-08", "src-1103"],
  ["resume-09", "src-1119"], ["resume-10", "src-1095"],
]);

const p0Representatives = new Map([
  ["简历真实性与个人贡献边界", { sourceId: "src-0950", detail: "项目数据量题可追问个人实验、指标口径及哪些结论确有证据" }],
  ["求职定位与项目叙事", { sourceId: "src-1103", detail: "LLM 与 Agent 的边界题可说明 Java 工程能力如何落到大模型应用岗位" }],
  ["Java 后端实习与秒杀链路", { sourceId: "src-0423", detail: "秒杀系统设计题直接覆盖库存、幂等、消息和补偿链路" }],
  ["RAG 全链路与质量评测", { sourceId: "src-1162", detail: "完整 RAG 工作流题覆盖入库、召回、生成及质量定位" }],
  ["Agent 与 Multi-Agent 取舍", { sourceId: "src-1121", detail: "Agent 与 Workflow 对比题直接检验动态编排与确定流程的取舍" }],
  ["Tool Calling 与 MCP 安全", { sourceId: "src-1119", detail: "Agent 数据库访问安全题直接覆盖鉴权、越权和工具结果可信边界" }],
  ["智能运维 Agent 的证据链", { sourceId: "src-1118", detail: "任务幻觉题要求工具真实执行后才能形成诊断证据与结论" }],
  ["智能求职 Agent 的业务闭环", { sourceId: "src-1114", detail: "Agent 核心组件题可串联路由、工具、知识库、状态和结果回写" }],
  ["大模型应用故障与安全", { sourceId: "src-1146", detail: "幻觉成因与缓解题直接对应大模型应用的故障边界" }],
]);

const topicRules = new Map([
  ["Java 后端实习与秒杀链路", { modules: ["分布式系统", "消息队列"], keywords: ["秒杀", "库存", "幂等", "限流", "补偿", "重复消费"] }],
  ["RAG 全链路与质量评测", { modules: ["RAG"], keywords: ["Embedding", "检索", "切片", "召回", "评测", "Top-K"] }],
  ["Agent 与 Multi-Agent 取舍", { modules: ["Agent"], keywords: ["Workflow", "Supervisor", "Planner", "Executor", "重规划", "多 Agent"] }],
  ["Tool Calling 与 MCP 安全", { modules: ["LLM工具调用"], keywords: ["MCP", "Function Calling", "权限", "Schema", "审计"] }],
  ["大模型应用故障与安全", { modules: ["LLM工程"], keywords: ["幻觉", "Prompt Injection", "限流", "重试", "降级", "API Key"] }],
  ["Java 并发与流式接口", { modules: ["Java基础", "并发编程"], keywords: ["线程池", "CompletableFuture", "背压", "SseEmitter", "客户端断开"] }],
  ["Spring Boot 请求链路与工程规范", { modules: ["Spring"], keywords: ["Controller", "Service", "Mapper", "参数校验", "事务"] }],
  ["MySQL 数据建模与事务", { modules: ["MySQL"], keywords: ["MVCC", "联合索引", "唯一索引", "分页", "事务"] }],
  ["Redis 与消息最终一致性", { modules: ["Redis", "消息队列"], keywords: ["Lua", "缓存一致性", "RocketMQ", "重复消费", "死信", "补偿"] }],
  ["Milvus 与向量数据生命周期", { modules: ["RAG"], keywords: ["Milvus", "Collection", "向量维度", "Metadata", "索引", "文档更新"] }],
  ["会话记忆与多租户隔离", { modules: ["Agent"], keywords: ["Session ID", "历史窗口", "Token 超限", "记忆", "user_id", "tenant_id"] }],
  ["SSE 协议与异常收尾", { modules: ["LLM工具调用", "LLM工程"], keywords: ["SSE", "text/event-stream", "客户端断开", "重连", "事件 ID"] }],
  ["可观测性与生产化设计", { modules: ["LLM工程", "Agent"], keywords: ["Trace ID", "首 Token", "总延迟", "Token 用量", "工具成功率", "脱敏"] }],
  ["Transformer 与模型参数基础", { modules: ["LLM工程"], keywords: ["Tokenization", "Self-Attention", "Causal Mask", "KV Cache", "Temperature", "Top-P", "上下文窗口"] }],
  ["声波与 IMU 定位项目", { modules: [], keywords: ["声波测距", "FFT", "IMU", "传感器融合", "误差统计"] }],
  ["应用算法成长路线", { modules: ["LLM工程", "RAG"], keywords: ["Python", "PyTorch", "评测集", "Reranker", "微调", "实验复现"] }],
]);

function parseArguments(arguments_) {
  const options = { databasePath: fileURLToPath(defaultDatabasePath), focusPath: fileURLToPath(defaultFocusPath) };
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument !== "--database" && argument !== "--focus") throw new Error(`unknown argument: ${argument}`);
    const value = arguments_[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`missing value for ${argument}`);
    options[argument === "--database" ? "databasePath" : "focusPath"] = resolve(value);
    index += 1;
  }
  return options;
}

function requireFile(path, label) {
  if (!existsSync(path) || !statSync(path).isFile()) throw new Error(`${label} does not exist: ${path}`);
}

function normalized(value) {
  return String(value ?? "").normalize("NFKC").toLocaleLowerCase("zh-CN");
}

function comparableTitle(value) {
  return normalized(value)
    .replace(/[\p{P}\p{S}\s]/gu, "")
    .replace(/请介绍一下|介绍一下|是什么|有什么|如何|为什么|怎么|说说|讲讲/g, "");
}

function bigrams(value) {
  const text = comparableTitle(value);
  return new Set([...text].map((_, index) => text.slice(index, index + 2)).filter((term) => term.length === 2));
}

function titleSimilarity(left, right) {
  const a = bigrams(left);
  const b = bigrams(right);
  let overlap = 0;
  for (const term of a) if (b.has(term)) overlap += 1;
  return (2 * overlap) / (a.size + b.size || 1);
}

function validateFocusConfiguration(configuration) {
  if (!Array.isArray(configuration?.priorityTopics) || configuration.priorityTopics.length === 0) {
    throw new Error("focus configuration must contain priorityTopics");
  }
  for (const topic of configuration.priorityTopics) {
    if (!topic.module || !priorityRank.has(topic.priority) || !Array.isArray(topic.keywords) || topic.keywords.length === 0 || !topic.reason) {
      throw new Error(`invalid priority topic: ${topic?.module ?? "<unknown>"}`);
    }
  }
}

function addAssignment(assignments, row, priority, reason) {
  const existing = assignments.get(row.id);
  if (!existing) {
    assignments.set(row.id, { priority, reasons: [reason] });
    return;
  }
  if (priorityRank.get(priority) > priorityRank.get(existing.priority)) existing.priority = priority;
  if (!existing.reasons.includes(reason)) existing.reasons.push(reason);
}

function findLegacyMatch(legacy, rows, rowsBySourceId, claimed) {
  const manualSourceId = manualLegacyMappings.get(legacy.id);
  if (manualSourceId) return { row: rowsBySourceId.get(manualSourceId), score: 1, method: "人工 source_id 覆盖" };
  const ranked = rows
    .filter((row) => !claimed.has(row.id))
    .map((row) => ({ row, score: Math.max(titleSimilarity(legacy.question, row.question), titleSimilarity(legacy.question, row.original_title)) }))
    .sort((left, right) => right.score - left.score || left.row.id - right.row.id);
  if (ranked[0]?.score >= 0.34) return { ...ranked[0], method: ranked[0].score === 1 ? "规范化精确匹配" : "标题高相似匹配" };
  return null;
}

export function mapResumePriorities(databasePath, focusPath) {
  requireFile(databasePath, "database");
  requireFile(focusPath, "focus configuration");
  const configuration = JSON.parse(readFileSync(focusPath, "utf8"));
  validateFocusConfiguration(configuration);
  const topicsByName = new Map(configuration.priorityTopics.map((topic) => [topic.module, topic]));

  const database = new DatabaseSync(databasePath);
  try {
    database.exec("PRAGMA foreign_keys = ON");
    const rows = database.prepare(`
      SELECT q.id, q.source_id, q.question, q.original_title, q.module, q.submodule,
             COALESCE(group_concat(t.tag, ' '), '') tags, CASE WHEN a.id IS NULL THEN 0 ELSE 1 END has_answer
      FROM questions q LEFT JOIN tags t ON t.question_id=q.id LEFT JOIN answers a ON a.question_id=q.id
      GROUP BY q.id ORDER BY q.id
    `).all().map((row) => ({ ...row, searchText: normalized(`${row.question} ${row.original_title} ${row.submodule} ${row.tags}`) }));
    const rowsBySourceId = new Map(rows.map((row) => [row.source_id, row]));
    const assignments = new Map();
    const claimed = new Set();

    for (const legacy of legacyQuestions.filter((question) => question.resumeFocus)) {
      const match = findLegacyMatch(legacy, rows, rowsBySourceId, claimed);
      if (!match?.row) continue;
      claimed.add(match.row.id);
      addAssignment(assignments, match.row, legacy.priority,
        `原核心题 ${legacy.id} 关联：${match.method}“${legacy.question}”（相似度 ${match.score.toFixed(2)}）`);
    }

    for (const topic of configuration.priorityTopics) {
      const rule = topicRules.get(topic.module);
      if (!rule) continue;
      for (const row of rows) {
        if (assignments.has(row.id)) continue;
        const matched = rule.keywords.filter((keyword) => row.searchText.includes(normalized(keyword)));
        const moduleLimited = rule.modules.includes(row.module);
        if (matched.length < (moduleLimited ? 1 : 2)) continue;
        addAssignment(assignments, row, topic.priority,
          `${topic.module} 关联：${moduleLimited ? `限定模块 ${row.module}` : "多个强关键词共同命中"}；命中 ${matched.join("、")}`);
      }
    }

    for (const [topicName, representative] of p0Representatives) {
      const topic = topicsByName.get(topicName);
      const row = rowsBySourceId.get(representative.sourceId);
      if (!topic || !row?.has_answer) throw new Error(`invalid answered P0 representative: ${topicName}`);
      addAssignment(assignments, row, "P0", `${topicName} 关联：${representative.detail}`);
    }

    const reviewableIds = [...assignments.entries()]
      .filter(([, assignment]) => assignment.priority === "P0" || assignment.priority === "P1")
      .map(([questionId]) => questionId);
    if (reviewableIds.some((id) => !rows.find((row) => row.id === id)?.has_answer)) {
      throw new Error("all P0/P1 questions must have answers before review");
    }
    const existingReviewDates = new Map(database.prepare(
      "SELECT question_id, reviewed_at FROM answer_reviews WHERE batch=?",
    ).all(reviewBatch).map((row) => [row.question_id, row.reviewed_at]));

    const clearPriority = database.prepare("UPDATE questions SET resume_focus=0, priority=NULL, resume_reason=''");
    const applyPriority = database.prepare("UPDATE questions SET resume_focus=1, priority=?, resume_reason=? WHERE id=?");
    const insertReview = database.prepare(`
      INSERT INTO answer_reviews(question_id,batch,status,notes,reviewed_at) VALUES(?,?,'passed',?,?)
    `);
    const markPriorityReviewed = database.prepare("UPDATE answers SET review_status='priority-reviewed' WHERE question_id=?");
    database.exec("BEGIN IMMEDIATE");
    try {
      clearPriority.run();
      database.prepare(`
        UPDATE answers SET review_status='draft'
        WHERE review_status='priority-reviewed'
          AND question_id IN (SELECT question_id FROM answer_reviews WHERE batch=?)
      `).run(reviewBatch);
      database.prepare("DELETE FROM answer_reviews WHERE batch=?").run(reviewBatch);
      for (const [questionId, assignment] of assignments) {
        const reason = assignment.reasons.join("\n");
        applyPriority.run(assignment.priority, reason, questionId);
        if (assignment.priority === "P0" || assignment.priority === "P1") {
          markPriorityReviewed.run(questionId);
          const notes = `复核：该题答案作为简历重点的通用知识支撑；不得据此宣称候选人已部署相关能力。涉及项目数据时须区分真实接入、Mock 演示和未来规划。映射依据：${reason}`;
          insertReview.run(questionId, reviewBatch, notes, existingReviewDates.get(questionId) ?? new Date().toISOString().slice(0, 10));
        }
      }
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }

    return Object.fromEntries(database.prepare(`
      SELECT priority,COUNT(*) count FROM questions WHERE priority IS NOT NULL GROUP BY priority ORDER BY priority
    `).all().map(({ priority, count }) => [priority, count]));
  } finally {
    database.close();
  }
}

const isMainModule = process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (isMainModule) {
  try {
    const { databasePath, focusPath } = parseArguments(process.argv.slice(2));
    console.log(`resume priorities mapped: ${JSON.stringify(mapResumePriorities(databasePath, focusPath))}`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
