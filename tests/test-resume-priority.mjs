import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { questions as legacyQuestions } from "../data/questions.js";

const projectRoot = resolve(import.meta.dirname, "..");
const temporaryDirectory = mkdtempSync(join(tmpdir(), "interview-priority-"));
const databasePath = join(temporaryDirectory, "interview_bank.sqlite");
const sourcePath = resolve(projectRoot, "data/source-index.json");
const batchesPath = resolve(projectRoot, "data/answer-batches");
const focusPath = resolve(projectRoot, "data/resume-focus.json");
const creatorPath = resolve(projectRoot, "scripts/create-database.mjs");
const importerPath = resolve(projectRoot, "scripts/import-answer-batches.mjs");
const mapperPath = resolve(projectRoot, "scripts/map-resume-priority.mjs");
const reviewBatch = "resume-priority-v2";

const p0Representatives = new Map([
  ["简历真实性与个人贡献边界", "src-0950"],
  ["求职定位与项目叙事", "src-1103"],
  ["Java 后端实习与秒杀链路", "src-0423"],
  ["RAG 全链路与质量评测", "src-1162"],
  ["Agent 与 Multi-Agent 取舍", "src-1121"],
  ["Tool Calling 与 MCP 安全", "src-1119"],
  ["智能运维 Agent 的证据链", "src-1118"],
  ["智能求职 Agent 的业务闭环", "src-1114"],
  ["大模型应用故障与安全", "src-1146"],
]);

const originalMappings = new Map([
  ["src-0549", "P1"], ["src-0184", "P1"], ["src-0572", "P1"],
  ["src-0428", "P1"], ["src-0439", "P1"], ["src-0067", "P1"],
  ["src-1131", "P1"], ["src-1114", "P0"], ["src-1118", "P0"],
  ["src-1179", "P0"], ["src-0068", "P0"], ["src-0423", "P0"],
  ["src-0950", "P0"], ["src-1121", "P0"], ["src-1103", "P0"],
  ["src-1119", "P0"], ["src-1095", "P0"],
]);

function run(script, arguments_) {
  const result = spawnSync(process.execPath, ["--disable-warning=ExperimentalWarning", script, ...arguments_], {
    cwd: projectRoot, encoding: "utf8",
  });
  assert.equal(result.status, 0, `${script} failed:\n${result.stdout}\n${result.stderr}`);
}

function runMapper() {
  run(mapperPath, ["--database", databasePath, "--focus", focusPath]);
}

try {
  run(creatorPath, ["--source", sourcePath, "--output", databasePath]);
  run(importerPath, ["--database", databasePath, "--batches", batchesPath]);

  const setupDatabase = new DatabaseSync(databasePath);
  assert.equal(setupDatabase.prepare("SELECT COUNT(*) count FROM questions WHERE priority IS NOT NULL").get().count, 0);
  setupDatabase.prepare(`
    UPDATE questions SET resume_focus=1, priority='P0', resume_reason='dirty Agent mapping'
    WHERE source_id='src-0025'
  `).run();
  setupDatabase.close();

  runMapper();

  const database = new DatabaseSync(databasePath, { readOnly: true });
  try {
    assert.equal(database.prepare("SELECT COUNT(*) count FROM questions").get().count, 1200);
    const focusedCount = database.prepare("SELECT COUNT(*) count FROM questions WHERE resume_focus=1").get().count;
    assert.ok(focusedCount >= 80 && focusedCount <= 180, `expected 80-180 focused questions, got ${focusedCount}`);
    for (const priority of ["P0", "P1", "P2"]) {
      assert.ok(database.prepare("SELECT COUNT(*) count FROM questions WHERE priority=?").get(priority).count > 0);
    }

    for (const sourceId of ["src-0025", "src-0219"]) {
      const row = database.prepare("SELECT resume_focus, priority, resume_reason FROM questions WHERE source_id=?").get(sourceId);
      assert.deepEqual({ ...row }, { resume_focus: 0, priority: null, resume_reason: "" }, `${sourceId} must not match Agent by 状态`);
    }

    for (const [topic, sourceId] of p0Representatives) {
      const row = database.prepare(`
        SELECT q.priority, q.resume_reason, a.id answer_id
        FROM questions q JOIN answers a ON a.question_id=q.id WHERE q.source_id=?
      `).get(sourceId);
      assert.equal(row.priority, "P0", `${topic} representative must be P0`);
      assert.match(row.resume_reason, new RegExp(topic));
      assert.match(row.resume_reason, /关联：/);
      assert.ok(row.answer_id);
    }

    for (const [sourceId, priority] of originalMappings) {
      assert.equal(database.prepare("SELECT priority FROM questions WHERE source_id=?").get(sourceId).priority, priority,
        `original resume question mapping missing for ${sourceId}`);
    }
    const mappedReasons = database.prepare("SELECT resume_reason FROM questions WHERE resume_focus=1")
      .all().map(({ resume_reason: reason }) => reason).join("\n");
    for (const legacy of legacyQuestions.filter((question) => question.resumeFocus)) {
      assert.match(mappedReasons, new RegExp(`原核心题 ${legacy.id} 关联`), `legacy focus question ${legacy.id} must be mapped`);
    }

    assert.equal(database.prepare(`
      SELECT COUNT(*) count FROM questions q JOIN answers a ON a.question_id=q.id
      WHERE q.priority IN ('P0','P1') AND a.review_status <> 'priority-reviewed'
    `).get().count, 0);
    assert.equal(database.prepare(`
      SELECT COUNT(*) count FROM questions q
      LEFT JOIN answer_reviews r ON r.question_id=q.id AND r.batch=?
      WHERE q.priority IN ('P0','P1')
        AND (r.status IS NULL OR r.status <> 'passed' OR length(trim(r.notes))=0
          OR (r.notes NOT LIKE '%通用知识%' AND r.notes NOT LIKE '%Mock%'))
    `).get(reviewBatch).count, 0);

    assert.equal(database.prepare(`
      SELECT COUNT(*) count FROM questions
      WHERE resume_focus=0 AND (priority IS NOT NULL OR resume_reason <> '')
    `).get().count, 0);

    const firstPass = {
      questions: database.prepare("SELECT id,resume_focus,priority,resume_reason FROM questions ORDER BY id").all(),
      answers: database.prepare("SELECT question_id,review_status FROM answers ORDER BY question_id").all(),
      reviews: database.prepare("SELECT question_id,batch,status,notes,reviewed_at FROM answer_reviews WHERE batch=? ORDER BY question_id").all(reviewBatch),
    };
    database.close();
    runMapper();
    const secondDatabase = new DatabaseSync(databasePath, { readOnly: true });
    try {
      assert.deepEqual({
        questions: secondDatabase.prepare("SELECT id,resume_focus,priority,resume_reason FROM questions ORDER BY id").all(),
        answers: secondDatabase.prepare("SELECT question_id,review_status FROM answers ORDER BY question_id").all(),
        reviews: secondDatabase.prepare("SELECT question_id,batch,status,notes,reviewed_at FROM answer_reviews WHERE batch=? ORDER BY question_id").all(reviewBatch),
      }, firstPass, "mapping and review writes must be idempotent");
    } finally {
      secondDatabase.close();
    }
  } finally {
    if (database.isOpen) database.close();
  }
} finally {
  rmSync(temporaryDirectory, { recursive: true, force: true });
}

console.log("resume priority mapping tests passed");
