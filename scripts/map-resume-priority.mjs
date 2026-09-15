import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";

const defaultDatabasePath = new URL("../data/interview_bank.sqlite", import.meta.url);
const defaultFocusPath = new URL("../data/resume-focus.json", import.meta.url);
const priorityRank = new Map([["P0", 3], ["P1", 2], ["P2", 1]]);

const representativeHints = new Map([
  ["简历真实性与个人贡献边界", ["项目", "实现", "指标", "压测", "贡献"]],
  ["求职定位与项目叙事", ["自我介绍", "项目", "Java", "RAG", "Agent"]],
  ["Java 后端实习与秒杀链路", ["秒杀", "库存", "幂等", "消息", "限流"]],
  ["RAG 全链路与质量评测", ["RAG", "检索", "向量", "Embedding", "评测"]],
  ["Agent 与 Multi-Agent 取舍", ["Agent", "Multi-Agent", "规划", "状态", "工作流"]],
  ["Tool Calling 与 MCP 安全", ["MCP", "Function Calling", "工具调用", "权限", "Schema"]],
  ["智能运维 Agent 的证据链", ["故障", "日志", "CPU", "监控", "诊断"]],
  ["智能求职 Agent 的业务闭环", ["意图", "路由", "结构化", "用户", "Agent"]],
  ["大模型应用故障与安全", ["幻觉", "安全", "注入", "限流", "降级", "大模型"]],
]);

function parseArguments(arguments_) {
  const options = {
    databasePath: fileURLToPath(defaultDatabasePath),
    focusPath: fileURLToPath(defaultFocusPath),
  };
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

function matchScore(searchText, keywords) {
  return keywords.reduce((score, keyword) => {
    const term = normalized(keyword);
    return term && searchText.includes(term) ? score + Math.max(1, term.length) : score;
  }, 0);
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

function topicReason(topic) {
  return `${topic.module}：${topic.reason}`;
}

export function mapResumePriorities(databasePath, focusPath) {
  requireFile(databasePath, "database");
  requireFile(focusPath, "focus configuration");
  const configuration = JSON.parse(readFileSync(focusPath, "utf8"));
  validateFocusConfiguration(configuration);

  const database = new DatabaseSync(databasePath);
  try {
    database.exec("PRAGMA foreign_keys = ON");
    const rows = database.prepare(`
      SELECT q.id, q.question, q.original_title, q.module, q.submodule,
             COALESCE(group_concat(t.tag, ' '), '') AS tags,
             CASE WHEN a.id IS NULL THEN 0 ELSE 1 END AS has_answer
      FROM questions q
      LEFT JOIN tags t ON t.question_id = q.id
      LEFT JOIN answers a ON a.question_id = q.id
      GROUP BY q.id
      ORDER BY q.id
    `).all().map((row) => ({
      ...row,
      searchText: normalized(`${row.question} ${row.original_title} ${row.module} ${row.submodule} ${row.tags}`),
    }));

    const assignments = new Map();
    for (const row of rows) {
      let best;
      for (const topic of configuration.priorityTopics) {
        const score = matchScore(row.searchText, topic.keywords);
        if (score === 0) continue;
        const candidate = { topic, score };
        if (!best
          || priorityRank.get(topic.priority) > priorityRank.get(best.topic.priority)
          || (topic.priority === best.topic.priority && score > best.score)) {
          best = candidate;
        }
      }
      if (best) assignments.set(row.id, { priority: best.topic.priority, reasons: [topicReason(best.topic)] });
    }

    const p0Topics = configuration.priorityTopics.filter(({ priority }) => priority === "P0");
    const claimedRepresentatives = new Set();
    for (const topic of p0Topics) {
      const hints = [...topic.keywords, ...(representativeHints.get(topic.module) ?? [])];
      const candidates = rows
        .filter(({ has_answer: hasAnswer }) => hasAnswer === 1)
        .map((row) => ({ row, score: matchScore(row.searchText, hints) }))
        .filter(({ score }) => score > 0)
        .sort((left, right) => right.score - left.score || left.row.id - right.row.id);
      const representative = candidates.find(({ row }) => !claimedRepresentatives.has(row.id)) ?? candidates[0];
      if (!representative) throw new Error(`cannot find answered representative for P0 topic: ${topic.module}`);
      claimedRepresentatives.add(representative.row.id);
      const assignment = assignments.get(representative.row.id) ?? { priority: "P0", reasons: [] };
      assignment.priority = "P0";
      const reason = topicReason(topic);
      if (!assignment.reasons.includes(reason)) assignment.reasons.push(reason);
      assignments.set(representative.row.id, assignment);
    }

    const clearPriority = database.prepare(
      "UPDATE questions SET resume_focus = 0, priority = NULL, resume_reason = ''",
    );
    const applyPriority = database.prepare(`
      UPDATE questions SET resume_focus = 1, priority = ?, resume_reason = ? WHERE id = ?
    `);
    database.exec("BEGIN IMMEDIATE");
    try {
      clearPriority.run();
      for (const [questionId, assignment] of assignments) {
        applyPriority.run(assignment.priority, assignment.reasons.join("\n"), questionId);
      }
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }

    return Object.fromEntries(
      database.prepare(`
        SELECT priority, COUNT(*) AS count FROM questions
        WHERE priority IS NOT NULL GROUP BY priority ORDER BY priority
      `).all().map(({ priority, count }) => [priority, count]),
    );
  } finally {
    database.close();
  }
}

const isMainModule = process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (isMainModule) {
  try {
    const { databasePath, focusPath } = parseArguments(process.argv.slice(2));
    const counts = mapResumePriorities(databasePath, focusPath);
    console.log(`resume priorities mapped: ${JSON.stringify(counts)}`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
