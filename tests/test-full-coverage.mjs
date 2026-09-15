import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const sourceIndex = JSON.parse(await readFile(new URL("../data/source-index.json", import.meta.url), "utf8"));
const database = new DatabaseSync(fileURLToPath(new URL("../data/interview_bank.sqlite", import.meta.url)), { readOnly: true });
try {
  const scalar = (sql) => Number(Object.values(database.prepare(sql).get())[0]);
  assert.equal(scalar("SELECT COUNT(*) FROM questions"), 1200);
  assert.equal(scalar("SELECT COUNT(*) FROM answers"), 1200);
  assert.equal(scalar("SELECT COUNT(*) FROM questions q LEFT JOIN answers a ON a.question_id=q.id WHERE a.question_id IS NULL"), 0);
  assert.equal(scalar("SELECT COUNT(*) FROM (SELECT question_id FROM follow_ups GROUP BY question_id HAVING COUNT(*) NOT BETWEEN 2 AND 3)"), 0);
  assert.equal(scalar("SELECT COUNT(*) FROM answers WHERE trim(short_answer)='' OR trim(full_answer)='' OR trim(pitfalls)=''"), 0);
  assert.equal(scalar("SELECT COUNT(*) FROM (SELECT full_answer FROM answers GROUP BY full_answer HAVING COUNT(*)>1)"), 0);
  assert.deepEqual(database.prepare("PRAGMA foreign_key_check").all(), []);
  assert.equal(database.prepare("PRAGMA integrity_check").get().integrity_check, "ok");

  const rows = database.prepare("SELECT source_id, source_url FROM questions ORDER BY source_id").all();
  assert.equal(rows.length, sourceIndex.length);
  const expected = new Map(sourceIndex.map((row) => [row.id, row.url]));
  for (const row of rows) assert.equal(row.source_url, expected.get(row.source_id), `source URL mismatch: ${row.source_id}`);

  for (const sourceId of ["src-0464", "src-0465"]) {
    const answer = database.prepare(`
      SELECT a.short_answer shortAnswer, a.full_answer fullAnswer
      FROM questions q JOIN answers a ON a.question_id=q.id WHERE q.source_id=?
    `).get(sourceId);
    assert.doesNotMatch(answer.shortAnswer, /只是目录标题/, `${sourceId} must directly answer the normalized question`);
    assert.doesNotMatch(answer.fullAnswer, /准备时可/, `${sourceId} must be an interview answer, not a preparation outline`);
  }
  const reviewedAnswers = Object.fromEntries(database.prepare(`
    SELECT q.source_id sourceId, a.short_answer shortAnswer, a.full_answer fullAnswer
    FROM questions q JOIN answers a ON a.question_id=q.id
    WHERE q.source_id IN ('src-0450','src-0950','src-1084','src-1101')
  `).all().map((row) => [row.sourceId, row]));
  assert.doesNotMatch(reviewedAnswers["src-0450"].fullAnswer, /队列过期/, "queue expiration itself is not a dead-letter cause");
  assert.match(reviewedAnswers["src-0950"].shortAnswer, /数据量|指标/, "project scale question must answer with truthful metric dimensions");
  assert.doesNotMatch(reviewedAnswers["src-0950"].fullAnswer, /验证根因|实施修复/, "project scale answer must not drift into incident handling");
  assert.match(reviewedAnswers["src-1084"].shortAnswer, /自动配置/, "Spring Boot transaction answer must lead with auto-configuration");
  assert.match(reviewedAnswers["src-1101"].fullAnswer, /local|global|naive|mix/i, "LightRAG answer must explain concrete query modes");
} finally {
  database.close();
}
console.log("full coverage ok: 1200 questions and answers");
