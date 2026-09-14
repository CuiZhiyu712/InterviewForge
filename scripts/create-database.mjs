import { existsSync, renameSync, rmSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const sourceFile = new URL("../data/source-index.json", import.meta.url);
const databaseFile = new URL("../data/interview_bank.sqlite", import.meta.url);
const databasePath = fileURLToPath(databaseFile);
const temporaryPath = `${databasePath}.tmp`;

function normalizeQuestion(title) {
  const normalizedTitle = title.replace(/\s+/g, " ").trim();
  if (!normalizedTitle) {
    throw new Error("source title must not be empty");
  }

  if (/[?？。！!]$/.test(normalizedTitle)) {
    return normalizedTitle;
  }

  const questionLanguage = /(?:什么|为什么|怎么|如何|哪些|区别|是否|能否|有哪|多少|原理|流程|机制|作用|优缺点|场景|底层|实现|失效|一致性|线程安全|复杂度|生命周期|隔离级别|数据结构)/;
  if (questionLanguage.test(normalizedTitle)) {
    return `${normalizedTitle}？`;
  }

  const topic = normalizedTitle
    .replace(/^\d+(?:\.\d+)*\s*/, "")
    .replace(/(?:详解|总结|常见面试题|面试题)$/, "")
    .trim();
  return `请介绍一下${topic || normalizedTitle}。`;
}

function validateSources(sources) {
  if (!Array.isArray(sources) || sources.length !== 1200) {
    throw new Error(`source-index must contain exactly 1200 records; received ${sources?.length ?? "non-array"}`);
  }

  const sourceIds = new Set();
  for (const source of sources) {
    for (const field of ["id", "site", "title", "url", "module"]) {
      if (typeof source[field] !== "string" || !source[field].trim()) {
        throw new Error(`source ${source.id ?? "<unknown>"} has invalid ${field}`);
      }
    }
    if (sourceIds.has(source.id)) {
      throw new Error(`duplicate source id: ${source.id}`);
    }
    sourceIds.add(source.id);
    new URL(source.url);
  }
}

const sources = JSON.parse(await readFile(sourceFile, "utf8"));
validateSources(sources);

if (existsSync(temporaryPath)) {
  rmSync(temporaryPath);
}

const database = new DatabaseSync(temporaryPath);
try {
  database.exec("PRAGMA foreign_keys = ON");
  database.exec("BEGIN IMMEDIATE");
  try {
    database.exec(`
      CREATE TABLE questions (
        id INTEGER PRIMARY KEY,
        source_id TEXT NOT NULL UNIQUE,
        question TEXT NOT NULL CHECK (length(trim(question)) > 0),
        original_title TEXT NOT NULL CHECK (length(trim(original_title)) > 0),
        module TEXT NOT NULL CHECK (length(trim(module)) > 0),
        submodule TEXT NOT NULL DEFAULT '',
        difficulty TEXT NOT NULL DEFAULT '中等' CHECK (difficulty IN ('基础', '中等', '进阶')),
        source_site TEXT NOT NULL CHECK (length(trim(source_site)) > 0),
        source_url TEXT NOT NULL CHECK (length(trim(source_url)) > 0),
        resume_focus INTEGER NOT NULL DEFAULT 0 CHECK (resume_focus IN (0, 1)),
        priority TEXT CHECK (priority IS NULL OR priority IN ('P0', 'P1', 'P2')),
        resume_reason TEXT NOT NULL DEFAULT '',
        context_note TEXT NOT NULL DEFAULT ''
      ) STRICT;

      CREATE TABLE answers (
        id INTEGER PRIMARY KEY,
        question_id INTEGER NOT NULL,
        short_answer TEXT NOT NULL CHECK (length(trim(short_answer)) > 0),
        full_answer TEXT NOT NULL CHECK (length(trim(full_answer)) > 0),
        pitfalls TEXT NOT NULL CHECK (length(trim(pitfalls)) > 0),
        answer_origin TEXT NOT NULL DEFAULT '原创整理' CHECK (answer_origin = '原创整理'),
        review_status TEXT NOT NULL DEFAULT 'draft' CHECK (review_status IN ('draft', 'checked', 'priority-reviewed')),
        UNIQUE (question_id),
        FOREIGN KEY (question_id) REFERENCES questions(id) ON DELETE CASCADE
      ) STRICT;

      CREATE TABLE follow_ups (
        id INTEGER PRIMARY KEY,
        question_id INTEGER NOT NULL,
        position INTEGER NOT NULL CHECK (position >= 1),
        question TEXT NOT NULL CHECK (length(trim(question)) > 0),
        answer TEXT NOT NULL CHECK (length(trim(answer)) > 0),
        UNIQUE (question_id, position),
        FOREIGN KEY (question_id) REFERENCES questions(id) ON DELETE CASCADE
      ) STRICT;

      CREATE TABLE tags (
        id INTEGER PRIMARY KEY,
        question_id INTEGER NOT NULL,
        tag TEXT NOT NULL CHECK (length(trim(tag)) > 0),
        UNIQUE (question_id, tag),
        FOREIGN KEY (question_id) REFERENCES questions(id) ON DELETE CASCADE
      ) STRICT;

      CREATE TABLE answer_reviews (
        id INTEGER PRIMARY KEY,
        question_id INTEGER NOT NULL,
        batch TEXT NOT NULL CHECK (length(trim(batch)) > 0),
        status TEXT NOT NULL CHECK (status IN ('pending', 'passed', 'needs-revision')),
        notes TEXT NOT NULL DEFAULT '',
        reviewed_at TEXT,
        UNIQUE (question_id, batch),
        FOREIGN KEY (question_id) REFERENCES questions(id) ON DELETE CASCADE
      ) STRICT;

      CREATE INDEX questions_module_submodule_idx ON questions(module, submodule);
      CREATE INDEX questions_priority_idx ON questions(priority);
      CREATE INDEX follow_ups_question_idx ON follow_ups(question_id);
      CREATE INDEX tags_tag_idx ON tags(tag);
      CREATE INDEX answer_reviews_status_idx ON answer_reviews(status);
    `);

    const insertQuestion = database.prepare(`
      INSERT INTO questions (
        source_id, question, original_title, module, submodule,
        source_site, source_url
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    for (const source of sources) {
      insertQuestion.run(
        source.id,
        normalizeQuestion(source.title),
        source.title,
        source.module,
        source.submodule ?? "",
        source.site,
        source.url,
      );
    }

    const importedCount = database.prepare("SELECT COUNT(*) AS count FROM questions").get().count;
    if (importedCount !== sources.length) {
      throw new Error(`imported ${importedCount} of ${sources.length} sources`);
    }
    const foreignKeyProblems = database.prepare("PRAGMA foreign_key_check").all();
    if (foreignKeyProblems.length > 0) {
      throw new Error(`foreign key check failed: ${JSON.stringify(foreignKeyProblems)}`);
    }
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
} finally {
  database.close();
}

if (existsSync(databasePath)) {
  rmSync(databasePath);
}
renameSync(temporaryPath, databasePath);

console.log(`database created: ${sources.length} questions at ${databasePath}`);
