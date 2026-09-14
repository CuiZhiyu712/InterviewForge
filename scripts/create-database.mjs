import { closeSync, existsSync, openSync, renameSync, rmSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";

const defaultSourcePath = fileURLToPath(new URL("../data/source-index.json", import.meta.url));
const defaultDatabasePath = fileURLToPath(new URL("../data/interview_bank.sqlite", import.meta.url));

export function normalizeQuestion(title) {
  const withoutDirectoryNumber = title
    .replace(/^\s*(?:\d+(?:\s*[.．]\s*\d+)+|\d+\s*[、)）])\s*/, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!withoutDirectoryNumber) {
    throw new Error("source title must not be empty");
  }

  const hadQuestionMark = /[?？]+\s*$/.test(withoutDirectoryNumber);
  const text = withoutDirectoryNumber.replace(/[?？。.!！,，;；:：]+\s*$/, "").trim();
  const questionLanguage = /(?:什么|为什么|怎么|如何|哪些|是否|能否|有哪|多少|吗|呢)/;
  if (hadQuestionMark || questionLanguage.test(text)) {
    return `${text}？`;
  }

  const topic = text
    .replace(/(?:详解|总结|常见面试题|面试题)$/, "")
    .trim();
  return `请介绍一下${topic || text}。`;
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

export function replaceDatabase(temporaryPath, databasePath, operations = {}) {
  const rename = operations.rename ?? renameSync;
  const remove = operations.remove ?? rmSync;
  const exists = operations.exists ?? existsSync;
  const backupPath = operations.backupPath ?? `${databasePath}.${process.pid}-${randomUUID()}.bak`;

  const hasExistingDatabase = exists(databasePath);
  if (hasExistingDatabase) {
    rename(databasePath, backupPath);
  }

  try {
    rename(temporaryPath, databasePath);
  } catch (replacementError) {
    if (hasExistingDatabase) {
      try {
        if (exists(databasePath)) {
          remove(databasePath);
        }
        rename(backupPath, databasePath);
      } catch (recoveryError) {
        throw new AggregateError(
          [replacementError, recoveryError],
          `database replacement and recovery failed; preserved backup at ${backupPath}`,
        );
      }
    }
    throw replacementError;
  }

  if (hasExistingDatabase && exists(backupPath)) {
    remove(backupPath);
  }
}

function parseArguments(arguments_) {
  const options = { sourcePath: defaultSourcePath, databasePath: defaultDatabasePath };
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument !== "--source" && argument !== "--output") {
      throw new Error(`unknown argument: ${argument}`);
    }
    const value = arguments_[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`missing value for ${argument}`);
    }
    if (argument === "--source") options.sourcePath = resolve(value);
    if (argument === "--output") options.databasePath = resolve(value);
    index += 1;
  }
  return options;
}

async function createDatabase(sourcePath, databasePath) {
  const absoluteSourcePath = resolve(sourcePath);
  const absoluteDatabasePath = resolve(databasePath);
  const comparableSourcePath = process.platform === "win32" ? absoluteSourcePath.toLowerCase() : absoluteSourcePath;
  const comparableDatabasePath = process.platform === "win32" ? absoluteDatabasePath.toLowerCase() : absoluteDatabasePath;
  if (comparableSourcePath === comparableDatabasePath) {
    throw new Error("source and output must not refer to the same path");
  }

  const lockPath = `${absoluteDatabasePath}.lock`;
  let lockHandle;
  try {
    lockHandle = openSync(lockPath, "wx");
  } catch (error) {
    if (error.code === "EEXIST") {
      throw new Error(`database is locked; lock file exists: ${lockPath}`);
    }
    throw error;
  }

  let temporaryPath;
  try {
    const uniqueToken = `${process.pid}-${randomUUID()}`;
    temporaryPath = `${absoluteDatabasePath}.${uniqueToken}.tmp`;
    const backupPath = `${absoluteDatabasePath}.${uniqueToken}.bak`;
    const sources = JSON.parse(await readFile(absoluteSourcePath, "utf8"));
    validateSources(sources);

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
        context_note TEXT NOT NULL DEFAULT '',
        CHECK (
          (resume_focus = 0 AND priority IS NULL AND trim(resume_reason) = '')
          OR
          (resume_focus = 1 AND priority IN ('P0', 'P1', 'P2') AND length(trim(resume_reason)) > 0)
        )
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

    replaceDatabase(temporaryPath, absoluteDatabasePath, { backupPath });
    return sources.length;
  } finally {
    if (temporaryPath && existsSync(temporaryPath)) {
      rmSync(temporaryPath);
    }
    closeSync(lockHandle);
    rmSync(lockPath, { force: true });
  }
}

const isMainModule = process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (isMainModule) {
  const { sourcePath, databasePath } = parseArguments(process.argv.slice(2));
  const sourceCount = await createDatabase(sourcePath, databasePath);
  console.log(`database created: ${sourceCount} questions at ${databasePath}`);
}
