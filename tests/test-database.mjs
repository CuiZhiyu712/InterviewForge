import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { normalizeQuestion, replaceDatabase } from "../scripts/create-database.mjs";

const scriptPath = fileURLToPath(new URL("../scripts/create-database.mjs", import.meta.url));
const sourcePath = fileURLToPath(new URL("../data/source-index.json", import.meta.url));
const sources = JSON.parse(await readFile(sourcePath, "utf8"));
const temporaryDirectory = mkdtempSync(join(tmpdir(), "interview-bank-test-"));
const databasePath = join(temporaryDirectory, "generated.sqlite");

try {
  assert.equal(normalizeQuestion("  5.2   TCP 为什么需要三次握手？？  "), "TCP 为什么需要三次握手？");
  assert.equal(normalizeQuestion(" 4.1  Redis   持久化详解。。。"), "请介绍一下Redis 持久化。");
  assert.equal(normalizeQuestion("  10   JVM   内存模型  "), "请介绍一下JVM 内存模型。");
  assert.equal(normalizeQuestion("3个线程如何同步 ?"), "3个线程如何同步？", "a leading quantity is not a directory number");

  const replacementDirectory = join(temporaryDirectory, "replacement");
  const targetPath = join(replacementDirectory, "bank.sqlite");
  const temporaryPath = `${targetPath}.tmp`;
  const backupPath = `${targetPath}.bak`;
  await mkdir(replacementDirectory);
  writeFileSync(targetPath, "old database");
  writeFileSync(temporaryPath, "new database");
  assert.throws(
    () => replaceDatabase(temporaryPath, targetPath, {
      rename(from, to) {
        if (from === temporaryPath && to === targetPath) {
          throw new Error("injected replacement failure");
        }
        renameSync(from, to);
      },
      remove: rmSync,
    }),
    /injected replacement failure/,
  );
  assert.equal(readFileSync(targetPath, "utf8"), "old database", "failed replacement must restore the old database");
  assert.ok(!existsSync(backupPath), "restored replacement must not leave a backup behind");

  replaceDatabase(temporaryPath, targetPath);
  assert.equal(readFileSync(targetPath, "utf8"), "new database", "successful replacement must install the new database");
  assert.ok(!existsSync(backupPath), "successful replacement must remove its backup");

  const createResult = spawnSync(
    process.execPath,
    ["--disable-warning=ExperimentalWarning", scriptPath, "--source", sourcePath, "--output", databasePath],
    { encoding: "utf8", cwd: dirname(scriptPath) },
  );
  assert.equal(createResult.status, 0, `database creation failed:\n${createResult.stderr || createResult.stdout}`);
  assert.ok(existsSync(databasePath), "CLI must create the requested output database");

  const database = new DatabaseSync(databasePath);
  try {
    database.exec("PRAGMA foreign_keys = ON");
    const expectedTables = ["answer_reviews", "answers", "follow_ups", "questions", "tags"];
    const actualTables = database
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
      .all()
      .map(({ name }) => name);
    assert.deepEqual(actualTables, expectedTables, "database must contain the five required tables");

    const [{ count }] = database.prepare("SELECT COUNT(*) AS count FROM questions").all();
    assert.equal(count, 1200, "questions must contain exactly 1,200 source records");
    assert.equal(count, sources.length, "database and source-index counts must match");

    const rows = database.prepare(`
      SELECT source_id, question, original_title, module, submodule, source_site, source_url
      FROM questions
      ORDER BY source_id
    `).all();
    const sortedSources = [...sources].sort((left, right) => left.id.localeCompare(right.id));
    for (let index = 0; index < sortedSources.length; index += 1) {
      const source = sortedSources[index];
      const row = rows[index];
      assert.equal(row.source_id, source.id, `source_id mismatch for ${source.id}`);
      assert.equal(row.original_title, source.title, `original_title mismatch for ${source.id}`);
      assert.equal(row.module, source.module, `module mismatch for ${source.id}`);
      assert.equal(row.submodule, source.submodule ?? "", `submodule mismatch for ${source.id}`);
      assert.equal(row.source_site, source.site, `source_site mismatch for ${source.id}`);
      assert.equal(row.source_url, source.url, `source_url mismatch for ${source.id}`);
      assert.ok(row.question.trim(), `normalized question must be non-empty for ${source.id}`);
    }

    const existing = database.prepare("SELECT * FROM questions ORDER BY id LIMIT 1").get();
    const insertQuestion = database.prepare(`
      INSERT INTO questions (
        source_id, question, original_title, module, submodule, difficulty,
        source_site, source_url, resume_focus, resume_reason, context_note
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, '', '')
    `);
    assert.throws(
      () => insertQuestion.run(existing.source_id, "重复来源", "重复来源", "测试", "", "基础", "测试", "https://example.com/duplicate"),
      /UNIQUE constraint failed/i,
      "duplicate source_id must violate UNIQUE",
    );
    assert.throws(
      () => insertQuestion.run("invalid-check", "非法难度", "非法难度", "测试", "", "未知", "测试", "https://example.com/check"),
      /CHECK constraint failed/i,
      "invalid difficulty must violate CHECK",
    );
    assert.throws(
      () => database.prepare("INSERT INTO tags (question_id, tag) VALUES (?, ?)").run(999999, "orphan"),
      /FOREIGN KEY constraint failed/i,
      "orphan tag must violate its foreign key",
    );

    assert.equal(database.prepare("PRAGMA foreign_keys").get().foreign_keys, 1, "foreign keys must be enabled");
    assert.deepEqual(database.prepare("PRAGMA foreign_key_check").all(), [], "foreign key check must be clean");
    assert.equal(database.prepare("PRAGMA integrity_check").get().integrity_check, "ok", "integrity check must pass");
  } finally {
    database.close();
  }
} finally {
  rmSync(temporaryDirectory, { recursive: true, force: true });
}

console.log(`database ok: ${sources.length} questions, constraints enforced, replacement recoverable`);
