import assert from "node:assert/strict";
import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";

const projectRoot = resolve(import.meta.dirname, "..");
const temporaryDirectory = mkdtempSync(join(tmpdir(), "interview-priority-"));
const databasePath = join(temporaryDirectory, "interview_bank.sqlite");
const focusPath = resolve(projectRoot, "data/resume-focus.json");
const scriptPath = resolve(projectRoot, "scripts/map-resume-priority.mjs");

const p0Topics = [
  "简历真实性与个人贡献边界",
  "求职定位与项目叙事",
  "Java 后端实习与秒杀链路",
  "RAG 全链路与质量评测",
  "Agent 与 Multi-Agent 取舍",
  "Tool Calling 与 MCP 安全",
  "智能运维 Agent 的证据链",
  "智能求职 Agent 的业务闭环",
  "大模型应用故障与安全",
];

function runMapper() {
  const result = spawnSync(
    process.execPath,
    ["--disable-warning=ExperimentalWarning", scriptPath, "--database", databasePath, "--focus", focusPath],
    { cwd: projectRoot, encoding: "utf8" },
  );
  assert.equal(result.status, 0, `mapper failed:\n${result.stdout}\n${result.stderr}`);
}

try {
  copyFileSync(resolve(projectRoot, "data/interview_bank.sqlite"), databasePath);
  runMapper();

  const database = new DatabaseSync(databasePath, { readOnly: true });
  try {
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM questions").get().count, 1200);
    for (const priority of ["P0", "P1", "P2"]) {
      assert.ok(
        database.prepare("SELECT COUNT(*) AS count FROM questions WHERE priority = ?").get(priority).count > 0,
        `${priority} must contain at least one question`,
      );
    }

    for (const topic of p0Topics) {
      const representative = database.prepare(`
        SELECT q.id
        FROM questions q JOIN answers a ON a.question_id = q.id
        WHERE q.priority = 'P0' AND q.resume_focus = 1 AND q.resume_reason LIKE ?
          AND length(trim(a.short_answer)) > 0 AND length(trim(a.full_answer)) > 0
        LIMIT 1
      `).get(`%${topic}%`);
      assert.ok(representative, `P0 topic lacks an answered representative: ${topic}`);
    }

    assert.equal(
      database.prepare(`
        SELECT COUNT(*) AS count FROM questions
        WHERE resume_focus = 1
          AND (priority NOT IN ('P0', 'P1', 'P2') OR length(trim(resume_reason)) = 0)
      `).get().count,
      0,
    );
    assert.equal(
      database.prepare(`
        SELECT COUNT(*) AS count FROM questions
        WHERE resume_focus = 0 AND (priority IS NOT NULL OR resume_reason <> '')
      `).get().count,
      0,
      "non-focus questions must not retain priority metadata",
    );
    assert.equal(
      database.prepare(`
        SELECT COUNT(*) AS count
        FROM questions q LEFT JOIN answers a ON a.question_id = q.id
        WHERE q.resume_focus = 1 AND a.id IS NULL
      `).get().count,
      0,
      "every resume-focused question must have an answer",
    );

    const firstPass = database.prepare(`
      SELECT id, resume_focus, priority, resume_reason FROM questions ORDER BY id
    `).all();
    database.close();
    runMapper();
    const secondDatabase = new DatabaseSync(databasePath, { readOnly: true });
    try {
      const secondPass = secondDatabase.prepare(`
        SELECT id, resume_focus, priority, resume_reason FROM questions ORDER BY id
      `).all();
      assert.deepEqual(secondPass, firstPass, "mapping must be idempotent");
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
