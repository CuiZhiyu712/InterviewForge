import assert from "node:assert/strict";
import { copyFileSync, existsSync, linkSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { normalizeQuestion, recoverStaleDatabaseState, replaceDatabase } from "../scripts/create-database.mjs";

const scriptPath = fileURLToPath(new URL("../scripts/create-database.mjs", import.meta.url));
const sourcePath = fileURLToPath(new URL("../data/source-index.json", import.meta.url));
const committedDatabasePath = fileURLToPath(new URL("../data/interview_bank.sqlite", import.meta.url));
const sources = JSON.parse(await readFile(sourcePath, "utf8"));
const temporaryDirectory = mkdtempSync(join(tmpdir(), "interview-bank-test-"));
const databasePath = join(temporaryDirectory, "generated.sqlite");

try {
  assert.equal(normalizeQuestion("  5.2   TCP 为什么需要三次握手？？  "), "TCP 为什么需要三次握手？");
  assert.equal(normalizeQuestion(" 4.1  Redis   持久化详解。。。"), "请介绍一下Redis 持久化。");
  assert.equal(normalizeQuestion("  10、   JVM   内存模型  "), "请介绍一下JVM 内存模型。");
  assert.equal(normalizeQuestion("7) JVM 垃圾回收"), "请介绍一下JVM 垃圾回收。");
  assert.equal(normalizeQuestion("4399 Java 面试"), "请介绍一下4399 Java 面试。", "numeric brands must be preserved");
  assert.equal(normalizeQuestion("3个线程如何同步 ?"), "3个线程如何同步？", "a leading quantity is not a directory number");

  const replacementDirectory = join(temporaryDirectory, "replacement");
  const targetPath = join(replacementDirectory, "bank.sqlite");
  const temporaryPath = `${targetPath}.tmp`;
  const backupPath = `${targetPath}.test-backup.bak`;
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
      backupPath,
    }),
    /injected replacement failure/,
  );
  assert.equal(readFileSync(targetPath, "utf8"), "old database", "failed replacement must restore the old database");
  assert.ok(!existsSync(backupPath), "restored replacement must not leave a backup behind");

  replaceDatabase(temporaryPath, targetPath, { backupPath });
  assert.equal(readFileSync(targetPath, "utf8"), "new database", "successful replacement must install the new database");
  assert.ok(!existsSync(backupPath), "successful replacement must remove its backup");

  const interruptedTargetPath = join(replacementDirectory, "interrupted.sqlite");
  const interruptedLockPath = `${interruptedTargetPath}.lock`;
  const interruptedBackupPath = `${interruptedTargetPath}.43210-deadbeef.bak`;
  writeFileSync(interruptedBackupPath, "interrupted old database");
  writeFileSync(interruptedLockPath, JSON.stringify({ pid: 43210, createdAt: "2026-09-14T00:00:00.000Z" }));
  const recovered = recoverStaleDatabaseState(interruptedTargetPath, interruptedLockPath, {
    now: () => Date.parse("2026-09-14T01:00:00.000Z"),
    isProcessAlive: () => false,
  });
  assert.equal(recovered, true, "an old dead lock with one backup must be recovered");
  assert.equal(readFileSync(interruptedTargetPath, "utf8"), "interrupted old database");
  assert.ok(!existsSync(interruptedBackupPath));
  assert.ok(!existsSync(interruptedLockPath));

  const staleTargetPath = join(replacementDirectory, "stale.sqlite");
  const staleLockPath = `${staleTargetPath}.lock`;
  const staleBackupOne = `${staleTargetPath}.43212-first.bak`;
  const staleBackupTwo = `${staleTargetPath}.43212-second.bak`;
  writeFileSync(staleTargetPath, "current database");
  writeFileSync(staleBackupOne, "stale backup one");
  writeFileSync(staleBackupTwo, "stale backup two");
  writeFileSync(staleLockPath, JSON.stringify({ pid: 43212, createdAt: "2026-09-14T00:00:00.000Z" }));
  const staleCleaned = recoverStaleDatabaseState(staleTargetPath, staleLockPath, {
    now: () => Date.parse("2026-09-14T01:00:00.000Z"),
    isProcessAlive: () => false,
  });
  assert.equal(staleCleaned, true);
  assert.equal(readFileSync(staleTargetPath, "utf8"), "current database", "recovery must preserve an existing target");
  assert.ok(!existsSync(staleBackupOne));
  assert.ok(!existsSync(staleBackupTwo));
  assert.ok(!existsSync(staleLockPath));

  const freshTargetPath = join(replacementDirectory, "fresh.sqlite");
  const freshLockPath = `${freshTargetPath}.lock`;
  const freshBackupPath = `${freshTargetPath}.43211-fresh.bak`;
  writeFileSync(freshBackupPath, "fresh backup");
  writeFileSync(freshLockPath, JSON.stringify({ pid: 43211, createdAt: "2026-09-14T00:59:00.000Z" }));
  const freshRecovered = recoverStaleDatabaseState(freshTargetPath, freshLockPath, {
    now: () => Date.parse("2026-09-14T01:00:00.000Z"),
    isProcessAlive: () => false,
  });
  assert.equal(freshRecovered, false, "a fresh dead lock must not be recovered before the threshold");
  assert.ok(!existsSync(freshTargetPath));
  assert.ok(existsSync(freshBackupPath));
  assert.ok(existsSync(freshLockPath));

  const activeTargetPath = join(replacementDirectory, "active.sqlite");
  const activeLockPath = `${activeTargetPath}.lock`;
  const activeBackupPath = `${activeTargetPath}.43213-active.bak`;
  writeFileSync(activeBackupPath, "active backup");
  writeFileSync(activeLockPath, JSON.stringify({ pid: 43213, createdAt: "2026-09-14T00:00:00.000Z" }));
  const activeRecovered = recoverStaleDatabaseState(activeTargetPath, activeLockPath, {
    now: () => Date.parse("2026-09-14T01:00:00.000Z"),
    isProcessAlive: () => true,
  });
  assert.equal(activeRecovered, false, "an old lock owned by a live process must not be recovered");
  assert.ok(!existsSync(activeTargetPath));
  assert.ok(existsSync(activeBackupPath));
  assert.ok(existsSync(activeLockPath));

  const createResult = spawnSync(
    process.execPath,
    [scriptPath, "--source", sourcePath, "--output", databasePath],
    { encoding: "utf8", cwd: dirname(scriptPath) },
  );
  assert.equal(createResult.status, 0, `database creation failed:\n${createResult.stderr || createResult.stdout}`);
  assert.ok(existsSync(databasePath), "CLI must create the requested output database");
  assert.ok(!existsSync(`${databasePath}.lock`), "successful creation must release its lock");

  const sourceCopyPath = join(temporaryDirectory, "source-copy.json");
  copyFileSync(sourcePath, sourceCopyPath);
  const sourceCopyBefore = readFileSync(sourceCopyPath);
  const samePathResult = spawnSync(
    process.execPath,
    [scriptPath, "--source", sourceCopyPath, "--output", sourceCopyPath],
    { encoding: "utf8" },
  );
  assert.notEqual(samePathResult.status, 0, "source and output at the same normalized absolute path must be rejected");
  assert.match(samePathResult.stderr, /source and output.*same/i);
  assert.deepEqual(readFileSync(sourceCopyPath), sourceCopyBefore, "same-path rejection must not alter the source JSON");

  const hardLinkPath = join(temporaryDirectory, "source-hardlink.json");
  linkSync(sourceCopyPath, hardLinkPath);
  const hardLinkResult = spawnSync(
    process.execPath,
    [scriptPath, "--source", sourceCopyPath, "--output", hardLinkPath],
    { encoding: "utf8" },
  );
  assert.notEqual(hardLinkResult.status, 0, "source and output hard links to the same file must be rejected");
  assert.match(hardLinkResult.stderr, /source and output.*same/i);
  assert.deepEqual(readFileSync(sourceCopyPath), sourceCopyBefore, "hard-link rejection must not alter the source JSON");

  const lockPath = `${databasePath}.lock`;
  const databaseBeforeLockConflict = readFileSync(databasePath);
  writeFileSync(lockPath, JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }), { flag: "wx" });
  const filesBeforeLockConflict = readdirSync(temporaryDirectory).sort();
  const lockedResult = spawnSync(
    process.execPath,
    [scriptPath, "--source", sourcePath, "--output", databasePath],
    { encoding: "utf8" },
  );
  assert.notEqual(lockedResult.status, 0, "concurrent creation must be rejected");
  assert.match(lockedResult.stderr, /locked|lock file/i, "lock conflict must be explicit");
  assert.deepEqual(readFileSync(databasePath), databaseBeforeLockConflict, "lock conflict must not alter the existing database");
  assert.deepEqual(readdirSync(temporaryDirectory).sort(), filesBeforeLockConflict, "lock conflict must not create temporary files");
  rmSync(lockPath);

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
      assert.equal(row.question, normalizeQuestion(source.title), `normalized question mismatch for ${source.id}`);
    }
    assert.equal(
      database.prepare("SELECT question FROM questions WHERE source_id = 'src-0102'").get().question,
      "请介绍一下4399 Java 面试。",
      "the imported 4399 brand must be preserved",
    );
    assert.equal(
      database.prepare("SELECT COUNT(*) AS count FROM questions WHERE resume_focus = 0 AND priority IS NULL AND resume_reason = ''").get().count,
      1200,
      "initial import must contain only non-focus questions",
    );

    const existing = database.prepare("SELECT * FROM questions ORDER BY id LIMIT 1").get();
    const insertQuestion = database.prepare(`
      INSERT INTO questions (
        source_id, question, original_title, module, submodule, difficulty,
        source_site, source_url, resume_focus, resume_reason, context_note
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '')
    `);
    assert.throws(
      () => insertQuestion.run(existing.source_id, "重复来源", "重复来源", "测试", "", "基础", "测试", "https://example.com/duplicate", 0, ""),
      /UNIQUE constraint failed/i,
      "duplicate source_id must violate UNIQUE",
    );
    assert.throws(
      () => insertQuestion.run("invalid-check", "非法难度", "非法难度", "测试", "", "未知", "测试", "https://example.com/check", 0, ""),
      /CHECK constraint failed/i,
      "invalid difficulty must violate CHECK",
    );
    assert.throws(
      () => database.prepare("INSERT INTO tags (question_id, tag) VALUES (?, ?)").run(999999, "orphan"),
      /FOREIGN KEY constraint failed/i,
      "orphan tag must violate its foreign key",
    );
    assert.throws(
      () => database.prepare("UPDATE questions SET priority = 'P1', resume_reason = '不应存在' WHERE id = ?").run(existing.id),
      /CHECK constraint failed/i,
      "non-focus questions must not carry priority or reason",
    );
    assert.throws(
      () => database.prepare("UPDATE questions SET resume_focus = 1 WHERE id = ?").run(existing.id),
      /CHECK constraint failed/i,
      "focus questions must require a priority and non-empty reason",
    );
    assert.throws(
      () => database.prepare("UPDATE questions SET resume_focus = 1, priority = 'P0', resume_reason = '   ' WHERE id = ?").run(existing.id),
      /CHECK constraint failed/i,
      "focus question reasons must contain non-whitespace text",
    );

    assert.equal(database.prepare("PRAGMA foreign_keys").get().foreign_keys, 1, "foreign keys must be enabled");
    assert.deepEqual(database.prepare("PRAGMA foreign_key_check").all(), [], "foreign key check must be clean");
    assert.equal(database.prepare("PRAGMA integrity_check").get().integrity_check, "ok", "integrity check must pass");
  } finally {
    database.close();
  }

  const generatedSchemaDatabase = new DatabaseSync(databasePath, { readOnly: true });
  const committedDatabase = new DatabaseSync(committedDatabasePath, { readOnly: true });
  try {
    const committedRows = committedDatabase.prepare(`
      SELECT source_id, question, original_title, module, submodule, source_site, source_url
      FROM questions ORDER BY source_id
    `).all();
    const sortedSources = [...sources].sort((left, right) => left.id.localeCompare(right.id));
    assert.equal(committedRows.length, sortedSources.length, "committed database must cover every source");
    for (let index = 0; index < sortedSources.length; index += 1) {
      const source = sortedSources[index];
      const row = committedRows[index];
      assert.equal(row.source_id, source.id, `committed source_id mismatch for ${source.id}`);
      assert.equal(row.question, normalizeQuestion(source.title), `committed question mismatch for ${source.id}`);
      assert.equal(row.original_title, source.title, `committed original_title mismatch for ${source.id}`);
      assert.equal(row.module, source.module, `committed module mismatch for ${source.id}`);
      assert.equal(row.submodule, source.submodule ?? "", `committed submodule mismatch for ${source.id}`);
      assert.equal(row.source_site, source.site, `committed source_site mismatch for ${source.id}`);
      assert.equal(row.source_url, source.url, `committed source_url mismatch for ${source.id}`);
    }

    const tableNames = ["questions", "answers", "follow_ups", "tags", "answer_reviews"];
    for (const tableName of tableNames) {
      const generatedSql = generatedSchemaDatabase.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?").get(tableName).sql;
      const committedSql = committedDatabase.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?").get(tableName).sql;
      assert.equal(committedSql, generatedSql, `committed ${tableName} schema must match a fresh build`);
    }
  } finally {
    committedDatabase.close();
    generatedSchemaDatabase.close();
  }
} finally {
  rmSync(temporaryDirectory, { recursive: true, force: true });
}

console.log(`database ok: ${sources.length} questions, constraints enforced, replacement recoverable`);
