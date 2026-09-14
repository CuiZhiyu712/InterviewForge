import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { normalizedFullAnswer, validateAnswerRecord } from "../scripts/lib/answer-validation.mjs";

const sourceIds = new Set(["src-0001", "src-0002"]);
const longChineseAnswer = "完整回答需要解释定义机制实现步骤适用场景性能取舍异常处理监控指标和常见边界并结合工程实践说明原因".repeat(2);

function validRecord(overrides = {}) {
  return {
    sourceId: "src-0001",
    shortAnswer: "先定位现象，再依据证据缩小范围并验证结论。",
    fullAnswer: longChineseAnswer,
    followUps: [
      { question: "第一项追问是什么？", answer: "第一项追问有明确答案。" },
      { question: "第二项追问是什么？", answer: "第二项追问也有明确答案。" },
    ],
    pitfalls: ["不要脱离监控证据直接下结论。"],
    tags: ["排障", "工程实践"],
    difficulty: "中等",
    contextNote: "",
    ...overrides,
  };
}

assert.deepEqual(validateAnswerRecord(validRecord(), sourceIds), [], "a complete record must be valid");

const validEnglishAnswer = Array.from({ length: 45 }, (_, index) => `word${index}`).join(" ");
assert.deepEqual(validateAnswerRecord(validRecord({ fullAnswer: validEnglishAnswer }), sourceIds), []);
assert.ok(
  validateAnswerRecord(validRecord({ fullAnswer: Array.from({ length: 45 }, () => "a").join(" ") }), sourceIds)
    .some((error) => error.includes("fullAnswer")),
  "45 single-letter tokens must not satisfy the answer-length threshold",
);
assert.deepEqual(
  validateAnswerRecord(validRecord({
    shortAnswer: "SQL 参数占位符应绑定参数，不能拼接用户输入。",
    pitfalls: ["模板占位符是合法术语，不等于占位答案。"],
    tags: ["SQL参数占位符"],
    contextNote: "说明模板占位符与待补内容的区别。",
  }), sourceIds),
  [],
  "legitimate placeholder terminology must not be rejected",
);
assert.equal(
  normalizedFullAnswer("ＡＰＩ\u200b 调用  需要校验"),
  normalizedFullAnswer("API 调用需要校验"),
  "duplicate normalization must apply NFKC, remove zero-width characters, and ignore spacing",
);

const invalidCases = [
  ["missing source ID", { sourceId: "" }, "sourceId"],
  ["missing short answer", { shortAnswer: "" }, "shortAnswer"],
  ["short full answer", { fullAnswer: "内容太短。" }, "fullAnswer"],
  ["too few follow-ups", { followUps: [{ question: "追问？", answer: "回答。" }] }, "followUps"],
  ["too many follow-ups", { followUps: Array.from({ length: 4 }, (_, index) => ({ question: `追问${index}？`, answer: `回答${index}。` })) }, "followUps"],
  ["follow-up without answer", { followUps: [{ question: "追问一？", answer: "" }, { question: "追问二？", answer: "回答二。" }] }, "followUps[0].answer"],
  ["follow-up without question", { followUps: [{ question: "", answer: "回答一。" }, { question: "追问二？", answer: "回答二。" }] }, "followUps[0].question"],
  ["no pitfalls", { pitfalls: [] }, "pitfalls"],
  ["blank pitfall", { pitfalls: [" "] }, "pitfalls[0]"],
  ["no tags", { tags: [] }, "tags"],
  ["blank tag", { tags: [" "] }, "tags[0]"],
  ["unknown source", { sourceId: "src-9999" }, "sourceId"],
  ["invalid difficulty", { difficulty: "困难" }, "difficulty"],
  ["non-string context", { contextNote: 42 }, "contextNote"],
  ["TODO placeholder", { shortAnswer: "TODO 后续补充" }, "placeholder"],
  ["TBD placeholder", { fullAnswer: "TBD" }, "placeholder"],
  ["Chinese placeholder", { pitfalls: ["待补"] }, "placeholder"],
  ["ditto placeholder", { followUps: [{ question: "追问一？", answer: "同上" }, { question: "追问二？", answer: "回答二。" }] }, "placeholder"],
  ["omitted placeholder", { tags: ["略"] }, "placeholder"],
];

assert.ok(validateAnswerRecord(null, sourceIds).some((error) => error.includes("record")));

for (const [name, overrides, expectedFragment] of invalidCases) {
  const errors = validateAnswerRecord(validRecord(overrides), sourceIds);
  assert.ok(errors.length > 0, `${name} must be rejected`);
  assert.ok(
    errors.some((error) => error.includes(expectedFragment)),
    `${name} must report ${expectedFragment}; received ${JSON.stringify(errors)}`,
  );
}

const importerPath = fileURLToPath(new URL("../scripts/import-answer-batches.mjs", import.meta.url));
const creatorPath = fileURLToPath(new URL("../scripts/create-database.mjs", import.meta.url));
const sourceIndexPath = fileURLToPath(new URL("../data/source-index.json", import.meta.url));
const temporaryDirectory = mkdtempSync(join(tmpdir(), "answer-import-test-"));

function writeBatch(directory, name, records) {
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, name), `${JSON.stringify(records, null, 2)}\n`, "utf8");
}

function runImporter(databasePath, batchesPath) {
  return spawnSync(process.execPath, [importerPath, "--database", databasePath, "--batches", batchesPath], {
    encoding: "utf8",
  });
}

function snapshot(databasePath) {
  const database = new DatabaseSync(databasePath, { readOnly: true });
  try {
    return Object.fromEntries(
      ["questions", "answers", "follow_ups", "tags", "answer_reviews"].map((table) => [
        table,
        database.prepare(`SELECT * FROM ${table} ORDER BY id`).all(),
      ]),
    );
  } finally {
    database.close();
  }
}

try {
  const databasePath = join(temporaryDirectory, "bank.sqlite");
  const createResult = spawnSync(process.execPath, [creatorPath, "--source", sourceIndexPath, "--output", databasePath], {
    encoding: "utf8",
  });
  assert.equal(createResult.status, 0, `fresh database creation failed:\n${createResult.stderr || createResult.stdout}`);

  const missingDatabasePath = join(temporaryDirectory, "missing.sqlite");
  const preflightBatches = join(temporaryDirectory, "preflight-batches");
  writeBatch(preflightBatches, "preflight.json", [validRecord()]);
  const missingResult = runImporter(missingDatabasePath, preflightBatches);
  assert.notEqual(missingResult.status, 0, "a missing database path must fail");
  assert.match(missingResult.stderr, /does not exist|regular file/i);
  assert.equal(existsSync(missingDatabasePath), false, "a bad database path must not create a file");

  const directoryDatabasePath = join(temporaryDirectory, "database-directory");
  mkdirSync(directoryDatabasePath);
  const directoryResult = runImporter(directoryDatabasePath, preflightBatches);
  assert.notEqual(directoryResult.status, 0, "a directory must not be accepted as a database");
  assert.match(directoryResult.stderr, /regular file/i);

  const wrongSchemaPath = join(temporaryDirectory, "wrong-schema.sqlite");
  const wrongSchema = new DatabaseSync(wrongSchemaPath);
  wrongSchema.exec("CREATE TABLE unrelated (id INTEGER PRIMARY KEY) STRICT");
  wrongSchema.close();
  const wrongSchemaResult = runImporter(wrongSchemaPath, preflightBatches);
  assert.notEqual(wrongSchemaResult.status, 0, "a database with the wrong schema must fail preflight");
  assert.match(wrongSchemaResult.stderr, /missing required tables|schema/i);

  const duplicateSourceDirectory = join(temporaryDirectory, "duplicate-source");
  writeBatch(duplicateSourceDirectory, "duplicate.json", [validRecord(), validRecord()]);
  const beforeDuplicateSource = snapshot(databasePath);
  const duplicateSourceResult = runImporter(databasePath, duplicateSourceDirectory);
  assert.notEqual(duplicateSourceResult.status, 0, "a duplicate sourceId batch must fail");
  assert.match(duplicateSourceResult.stderr, /duplicate\.json.*src-0001|src-0001.*duplicate\.json/is);
  assert.deepEqual(snapshot(databasePath), beforeDuplicateSource, "validation failure must not change the database");

  const duplicateAnswerDirectory = join(temporaryDirectory, "duplicate-answer");
  const compatibilityEquivalentAnswer = `\u200b${longChineseAnswer} ＡＰＩ`;
  writeBatch(duplicateAnswerDirectory, "duplicate-answer.json", [
    validRecord({ fullAnswer: `${longChineseAnswer} API` }),
    validRecord({ sourceId: "src-0002", fullAnswer: compatibilityEquivalentAnswer }),
  ]);
  const duplicateAnswerResult = runImporter(databasePath, duplicateAnswerDirectory);
  assert.notEqual(duplicateAnswerResult.status, 0, "identical full answers must fail");
  assert.match(duplicateAnswerResult.stderr, /fullAnswer.*src-0001.*src-0002|fullAnswer.*src-0002.*src-0001/is);
  assert.deepEqual(snapshot(databasePath), beforeDuplicateSource, "duplicate-answer failure must not change the database");

  const validDirectory = join(temporaryDirectory, "valid");
  const secondAnswer = "第二道题的完整回答从定义开始说明核心机制然后讨论方案选择性能影响失败处理监控告警以及实际项目中的应用边界".repeat(2);
  writeBatch(validDirectory, "batch-a.json", [
    validRecord(),
    validRecord({
      sourceId: "src-0002",
      shortAnswer: "第二道题应先给出结论，再说明核心依据。",
      fullAnswer: secondAnswer,
      followUps: [
        { question: "第二题追问一？", answer: "第二题追问一答案。" },
        { question: "第二题追问二？", answer: "第二题追问二答案。" },
        { question: "第二题追问三？", answer: "第二题追问三答案。" },
      ],
      pitfalls: ["不要忽略第二道题的适用边界。"],
      tags: ["第二题"],
      difficulty: "进阶",
      contextNote: "按通用工程场景回答。",
    }),
  ]);
  const validResult = runImporter(databasePath, validDirectory);
  assert.equal(validResult.status, 0, `valid import failed:\n${validResult.stderr || validResult.stdout}`);

  let database = new DatabaseSync(databasePath);
  try {
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM answers").get().count, 2);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM follow_ups").get().count, 5);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM tags").get().count, 3);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM answer_reviews").get().count, 2);
    const imported = database.prepare(`
      SELECT q.difficulty, q.context_note, a.answer_origin, a.review_status, a.pitfalls
      FROM questions q JOIN answers a ON a.question_id = q.id
      WHERE q.source_id = 'src-0002'
    `).get();
    assert.equal(imported.difficulty, "进阶");
    assert.equal(imported.context_note, "按通用工程场景回答。");
    assert.equal(imported.answer_origin, "原创整理");
    assert.equal(imported.review_status, "draft");
    assert.deepEqual(JSON.parse(imported.pitfalls), ["不要忽略第二道题的适用边界。"]);
    const review = database.prepare(`
      SELECT ar.batch, ar.status FROM answer_reviews ar
      JOIN questions q ON q.id = ar.question_id WHERE q.source_id = 'src-0002'
    `).get();
    assert.match(review.batch, /^batch-a\.json#[a-f0-9]{64}$/);
    assert.equal(review.status, "pending");
    database.prepare("UPDATE answer_reviews SET status = 'passed', notes = '旧答案已审核', reviewed_at = '2026-09-14' WHERE question_id = (SELECT id FROM questions WHERE source_id = 'src-0001')").run();
  } finally {
    database.close();
  }

  const replacementDirectory = join(temporaryDirectory, "replacement-batch");
  writeBatch(replacementDirectory, "batch-b.json", [
    validRecord({
      shortAnswer: "重新导入后的一句话答案。",
      followUps: [
        { question: "替换后的追问一？", answer: "替换后的答案一。" },
        { question: "替换后的追问二？", answer: "替换后的答案二。" },
      ],
      pitfalls: ["重新导入后的易错点。"],
      tags: ["替换标签"],
      difficulty: "基础",
    }),
    validRecord({ sourceId: "src-0002", fullAnswer: secondAnswer }),
  ]);
  const idempotentResult = runImporter(databasePath, replacementDirectory);
  assert.equal(idempotentResult.status, 0, `idempotent import failed:\n${idempotentResult.stderr || idempotentResult.stdout}`);
  database = new DatabaseSync(databasePath);
  try {
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM answers").get().count, 2);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM follow_ups").get().count, 4);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM tags").get().count, 3);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM answer_reviews").get().count, 2);
    const reimported = database.prepare(`
      SELECT q.difficulty, a.short_answer FROM questions q JOIN answers a ON a.question_id = q.id
      WHERE q.source_id = 'src-0001'
    `).get();
    assert.deepEqual({ ...reimported }, { difficulty: "基础", short_answer: "重新导入后的一句话答案。" });
    assert.deepEqual(
      database.prepare(`SELECT t.tag FROM tags t JOIN questions q ON q.id=t.question_id WHERE q.source_id='src-0001'`).all().map(({ tag }) => tag),
      ["替换标签"],
    );
    const replacementReviews = database.prepare(`
      SELECT ar.batch, ar.status, ar.notes, ar.reviewed_at FROM answer_reviews ar
      JOIN questions q ON q.id=ar.question_id WHERE q.source_id='src-0001'
    `).all();
    assert.equal(replacementReviews.length, 1, "changing an answer in another batch must invalidate every old review");
    assert.match(replacementReviews[0].batch, /^batch-b\.json#[a-f0-9]{64}$/);
    assert.deepEqual(
      { status: replacementReviews[0].status, notes: replacementReviews[0].notes, reviewed_at: replacementReviews[0].reviewed_at },
      { status: "pending", notes: "", reviewed_at: null },
    );

    database.exec(`
      CREATE TRIGGER fail_answer_import BEFORE INSERT ON tags
      WHEN NEW.tag = '触发回滚'
      BEGIN SELECT RAISE(ABORT, 'injected import failure'); END;
    `);
  } finally {
    database.close();
  }

  const exactReimportResult = runImporter(databasePath, replacementDirectory);
  assert.equal(exactReimportResult.status, 0, `exact reimport failed:\n${exactReimportResult.stderr || exactReimportResult.stdout}`);
  database = new DatabaseSync(databasePath, { readOnly: true });
  try {
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM answers").get().count, 2);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM answer_reviews").get().count, 2);
  } finally {
    database.close();
  }

  const beforeTransactionFailure = snapshot(databasePath);
  const rollbackDirectory = join(temporaryDirectory, "rollback");
  writeBatch(rollbackDirectory, "rollback.json", [
    validRecord({ shortAnswer: "此修改必须被回滚。", tags: ["普通标签"] }),
    validRecord({ sourceId: "src-0002", fullAnswer: secondAnswer, tags: ["触发回滚"] }),
  ]);
  const rollbackResult = runImporter(databasePath, rollbackDirectory);
  assert.notEqual(rollbackResult.status, 0, "a database write error must fail the import");
  assert.match(rollbackResult.stderr, /injected import failure/i);
  assert.deepEqual(snapshot(databasePath), beforeTransactionFailure, "a transaction error must roll back every table change");
} finally {
  rmSync(temporaryDirectory, { recursive: true, force: true });
}

console.log("answer validation and transactional import ok");
