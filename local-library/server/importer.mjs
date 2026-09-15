import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync } from "node:fs";
import { relative, resolve, sep } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const sourcesRoot = resolve(root, "sources");
const databasePath = resolve(root, "data", "open-source.sqlite");

export const repositories = [
  ["JavaGuide", "https://github.com/Snailclimb/JavaGuide"],
  ["advanced-java", "https://github.com/doocs/advanced-java"],
  ["LLMInterviewQuestions", "https://github.com/llmgenai/LLMInterviewQuestions"],
  ["ai-handbook", "https://github.com/nageoffer/ai-handbook"],
  ["AgentGuide", "https://github.com/adongwanai/AgentGuide"],
  ["agent-interview-100", "https://github.com/BigKunLun/agent-interview-100"],
  ["llm-interview-questions", "https://github.com/MisterBooo/llm-interview-questions"],
  ["awesome-ai-engineer-interview", "https://github.com/landedjobs/awesome-ai-engineer-interview"],
];

const moduleRules = [
  ["Agent", /agent|智能体|multi-agent|tool.use|工具调用|memory|planning/i],
  ["RAG", /\brag\b|retriev|向量|embedding|chunk|graph.?rag|检索增强/i],
  ["LLM", /\bllm\b|大模型|transformer|prompt|微调|推理|token|模型评估/i],
  ["MySQL", /mysql|数据库|database|索引|事务|sql|innodb/i],
  ["Redis", /redis|缓存|cache/i],
  ["消息队列", /kafka|rabbitmq|rocketmq|消息队列|\bmq\b/i],
  ["Spring", /spring|mybatis|hibernate/i],
  ["Java并发", /concurr|并发|线程|thread|lock|锁|volatile|synchronized/i],
  ["JVM", /\bjvm\b|垃圾回收|\bgc\b|类加载/i],
  ["Java集合", /collection|集合|hashmap|arraylist|concurrenthashmap/i],
  ["Java基础", /java|面向对象|异常|反射|泛型/i],
  ["网络", /network|网络|tcp|udp|http|https|dns/i],
  ["操作系统", /操作系统|operating.system|linux|进程|内存管理/i],
  ["分布式系统", /distributed|分布式|微服务|高可用|高并发|zookeeper|分库分表/i],
  ["系统设计", /system.design|系统设计|架构设计|case.stud/i],
  ["算法与数据结构", /algorithm|算法|data.structure|数据结构/i],
];

export function classifyModule(path, title = "") {
  const value = `${path} ${title}`;
  return moduleRules.find(([, pattern]) => pattern.test(value))?.[0] ?? "综合";
}

export function shouldImportFile(repository, relativePath) {
  const path = relativePath.replaceAll("\\", "/");
  if (/(^|\/)(?:\.github|docs?\/about-the-author)(\/|$)/i.test(path)) return false;
  if (/^(?:CODE_OF_CONDUCT|CONTRIBUTING|CHANGELOG|SECURITY)(?:_[A-Z]+)?\.md$/i.test(path)) return false;
  if (repository === "JavaGuide" && /^README_(?:EN|JA)\.md$/i.test(path)) return false;
  return true;
}

function cleanHeading(value) {
  return value.replace(/<[^>]+>/g, "").replace(/\[(.*?)\]\([^)]*\)/g, "$1").replace(/[*_`#]+/g, "").trim();
}

function looksLikeQuestion(title) {
  return /[?？]\s*$/.test(title) || /^(?:Q(?:uestion)?\s*\d+|问题\s*\d*|面试题\s*\d+)[.:：、\s]/i.test(title);
}

export function extractDocument({ repository, relativePath, markdown }) {
  const headingMatches = [...markdown.matchAll(/^(#{1,6})\s+(.+)$/gm)].map((match) => ({
    level: match[1].length,
    title: cleanHeading(match[2]),
    start: match.index,
    bodyStart: match.index + match[0].length,
  }));
  const sections = headingMatches.map((heading, index) => {
    const next = headingMatches.slice(index + 1).find((candidate) => candidate.level <= heading.level);
    const body = markdown.slice(heading.bodyStart, next?.start ?? markdown.length).trim();
    return { level: heading.level, title: heading.title, body };
  });
  const title = headingMatches[0]?.title || relativePath.split(/[\\/]/).at(-1).replace(/\.md$/i, "");
  const questions = sections.filter((section) => looksLikeQuestion(section.title)).map((section) => ({
    question: section.title,
    answer: section.body,
  }));
  for (const match of markdown.matchAll(/^\s*(?:[-*+]\s+|\d+[.)]\s+)([^\n?？]{8,}[?？])\s*$/gm)) {
    const question = cleanHeading(match[1]);
    if (!questions.some((item) => item.question === question)) questions.push({ question, answer: "" });
  }
  return { repository, relativePath, title, module: classifyModule(relativePath, title), sections, questions };
}

function markdownFiles(directory) {
  const files = [];
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if ([".git", "node_modules", ".venv", "vendor"].includes(entry.name)) continue;
      const fullPath = resolve(current, entry.name);
      if (entry.isDirectory()) walk(fullPath);
      else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md") && statSync(fullPath).size <= 4_000_000) files.push(fullPath);
    }
  };
  walk(directory);
  return files.sort();
}

function licenseText(directory) {
  const files = readdirSync(directory, { withFileTypes: true }).filter((entry) => entry.isFile() && /^(license|copying|notice)/i.test(entry.name));
  return files.map((entry) => `===== ${entry.name} =====\n${readFileSync(resolve(directory, entry.name), "utf8")}`).join("\n\n");
}

export function buildDatabase({ sourceDirectory = sourcesRoot, outputPath = databasePath } = {}) {
  mkdirSync(resolve(outputPath, ".."), { recursive: true });
  const temporaryPath = `${outputPath}.building`;
  rmSync(temporaryPath, { force: true });
  const database = new DatabaseSync(temporaryPath);
  database.exec(`
    PRAGMA foreign_keys=ON;
    CREATE TABLE repositories(id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, url TEXT NOT NULL, commit_hash TEXT NOT NULL, license_text TEXT NOT NULL, imported_at TEXT NOT NULL);
    CREATE TABLE documents(id INTEGER PRIMARY KEY, repository_id INTEGER NOT NULL REFERENCES repositories(id), module TEXT NOT NULL, title TEXT NOT NULL, relative_path TEXT NOT NULL, markdown TEXT NOT NULL, UNIQUE(repository_id, relative_path));
    CREATE TABLE questions(id INTEGER PRIMARY KEY, document_id INTEGER NOT NULL REFERENCES documents(id), repository_id INTEGER NOT NULL REFERENCES repositories(id), module TEXT NOT NULL, question TEXT NOT NULL, answer TEXT NOT NULL, relative_path TEXT NOT NULL);
    CREATE INDEX documents_module_idx ON documents(module);
    CREATE INDEX questions_module_idx ON questions(module);
    CREATE INDEX questions_repository_idx ON questions(repository_id);
  `);
  const addRepository = database.prepare("INSERT INTO repositories(name,url,commit_hash,license_text,imported_at) VALUES(?,?,?,?,?)");
  const addDocument = database.prepare("INSERT INTO documents(repository_id,module,title,relative_path,markdown) VALUES(?,?,?,?,?)");
  const addQuestion = database.prepare("INSERT INTO questions(document_id,repository_id,module,question,answer,relative_path) VALUES(?,?,?,?,?,?)");
  const importedAt = new Date().toISOString();
  let documentCount = 0;
  let questionCount = 0;
  database.exec("BEGIN IMMEDIATE");
  try {
    for (const [name, url] of repositories) {
      const directory = resolve(sourceDirectory, name);
      if (!existsSync(directory)) throw new Error(`source repository missing: ${name}`);
      const commit = execFileSync("git", ["-C", directory, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
      const repositoryId = Number(addRepository.run(name, url, commit, licenseText(directory), importedAt).lastInsertRowid);
      for (const fullPath of markdownFiles(directory)) {
        const relativePath = relative(directory, fullPath).split(sep).join("/");
        if (!shouldImportFile(name, relativePath)) continue;
        const markdown = readFileSync(fullPath, "utf8").replace(/^\uFEFF/, "");
        if (!markdown.trim()) continue;
        const document = extractDocument({ repository: name, relativePath, markdown });
        const documentId = Number(addDocument.run(repositoryId, document.module, document.title, relativePath, markdown).lastInsertRowid);
        documentCount += 1;
        for (const question of document.questions) {
          addQuestion.run(documentId, repositoryId, classifyModule(relativePath, question.question), question.question, question.answer, relativePath);
          questionCount += 1;
        }
      }
    }
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    database.close();
    rmSync(temporaryPath, { force: true });
    throw error;
  }
  const integrity = database.prepare("PRAGMA integrity_check").get().integrity_check;
  database.close();
  if (integrity !== "ok") throw new Error(`database integrity check failed: ${integrity}`);
  rmSync(outputPath, { force: true });
  renameSync(temporaryPath, outputPath);
  return { repositories: repositories.length, documents: documentCount, questions: questionCount, outputPath };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(buildDatabase(), null, 2));
}
