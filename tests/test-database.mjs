import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const databaseFile = new URL("../data/interview_bank.sqlite", import.meta.url);
const sourceFile = new URL("../data/source-index.json", import.meta.url);

assert.ok(existsSync(databaseFile), "database must exist; run npm run db:create");

const sources = JSON.parse(await readFile(sourceFile, "utf8"));
const database = new DatabaseSync(fileURLToPath(databaseFile), { readOnly: true });

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

  const [{ distinctSourceIds }] = database
    .prepare("SELECT COUNT(DISTINCT source_id) AS distinctSourceIds FROM questions")
    .all();
  assert.equal(distinctSourceIds, 1200, "source_id must be unique");

  const schemas = Object.fromEntries(
    database
      .prepare("SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
      .all()
      .map(({ name, sql }) => [name, sql]),
  );
  assert.match(schemas.questions, /source_id\s+TEXT\s+NOT NULL\s+UNIQUE/i, "questions.source_id must be unique");
  assert.match(schemas.questions, /CHECK\s*\(difficulty IN \('基础', '中等', '进阶'\)\)/i, "difficulty needs an enum check");
  assert.match(schemas.questions, /CHECK\s*\(priority IS NULL OR priority IN \('P0', 'P1', 'P2'\)\)/i, "priority needs an enum check");
  assert.match(schemas.answers, /UNIQUE\s*\(question_id\)/i, "answers must be one-to-one with questions");
  assert.match(schemas.answers, /CHECK\s*\(review_status IN \('draft', 'checked', 'priority-reviewed'\)\)/i, "review status needs an enum check");
  assert.match(schemas.tags, /UNIQUE\s*\(question_id, tag\)/i, "tags need a compound unique constraint");
  assert.match(schemas.follow_ups, /FOREIGN KEY\s*\(question_id\)/i, "follow-ups need a question foreign key");
  assert.match(schemas.answer_reviews, /FOREIGN KEY\s*\(question_id\)/i, "reviews need a question foreign key");

  assert.equal(database.prepare("PRAGMA foreign_keys").get().foreign_keys, 1, "foreign keys must be enabled");
  assert.deepEqual(database.prepare("PRAGMA foreign_key_check").all(), [], "foreign key check must be clean");
  assert.equal(database.prepare("PRAGMA integrity_check").get().integrity_check, "ok", "integrity check must pass");
} finally {
  database.close();
}

console.log(`database ok: ${sources.length} questions, five tables, foreign keys clean`);
