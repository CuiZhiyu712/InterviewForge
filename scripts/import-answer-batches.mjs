import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { basename, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { normalizedFullAnswer, validateAnswerRecord } from "./lib/answer-validation.mjs";

function parseArguments(arguments_) {
  const options = {};
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument !== "--database" && argument !== "--batches") {
      throw new Error(`unknown argument: ${argument}`);
    }
    const value = arguments_[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`missing value for ${argument}`);
    }
    options[argument === "--database" ? "databasePath" : "batchesPath"] = resolve(value);
    index += 1;
  }
  if (!options.databasePath) throw new Error("--database is required");
  if (!options.batchesPath) throw new Error("--batches is required");
  return options;
}

function loadBatchFiles(batchesPath) {
  const fileNames = readdirSync(batchesPath, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".json"))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));
  if (fileNames.length === 0) {
    throw new Error(`no JSON answer batches found in ${batchesPath}`);
  }

  return fileNames.map((fileName) => {
    const contents = readFileSync(resolve(batchesPath, fileName), "utf8");
    let records;
    try {
      records = JSON.parse(contents);
    } catch (error) {
      throw new Error(`${fileName}: invalid JSON: ${error.message}`);
    }
    if (!Array.isArray(records)) {
      throw new Error(`${fileName}: batch must be a JSON array`);
    }
    const normalizedName = basename(fileName).normalize("NFKC");
    const contentHash = createHash("sha256").update(contents, "utf8").digest("hex");
    return { batch: normalizedName, batchId: `${normalizedName}#${contentHash}`, records };
  });
}

const requiredSchema = {
  questions: ["id", "source_id", "difficulty", "context_note"],
  answers: ["question_id", "short_answer", "full_answer", "pitfalls", "answer_origin", "review_status"],
  follow_ups: ["question_id", "position", "question", "answer"],
  tags: ["question_id", "tag"],
  answer_reviews: ["question_id", "batch", "status", "notes", "reviewed_at"],
};

function validateDatabaseFile(databasePath) {
  if (!existsSync(databasePath)) {
    throw new Error(`database does not exist: ${databasePath}`);
  }
  if (!statSync(databasePath).isFile()) {
    throw new Error(`database must be a regular file: ${databasePath}`);
  }

  const database = new DatabaseSync(databasePath, { readOnly: true });
  try {
    const tableNames = new Set(
      database.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map(({ name }) => name),
    );
    const missingTables = Object.keys(requiredSchema).filter((table) => !tableNames.has(table));
    if (missingTables.length > 0) {
      throw new Error(`database schema is missing required tables: ${missingTables.join(", ")}`);
    }
    for (const [table, requiredColumns] of Object.entries(requiredSchema)) {
      const columns = new Set(database.prepare(`PRAGMA table_info(${table})`).all().map(({ name }) => name));
      const missingColumns = requiredColumns.filter((column) => !columns.has(column));
      if (missingColumns.length > 0) {
        throw new Error(`database schema table ${table} is missing required columns: ${missingColumns.join(", ")}`);
      }
    }
  } finally {
    database.close();
  }
}

function validateBatches(batches, sourceIds) {
  const errors = [];
  const sourceLocations = new Map();
  const answerLocations = new Map();

  for (const { batch, records } of batches) {
    for (const [index, record] of records.entries()) {
      const label = `${batch} record ${index + 1}${record?.sourceId ? ` (${record.sourceId})` : ""}`;
      for (const error of validateAnswerRecord(record, sourceIds)) {
        errors.push(`${label}: ${error}`);
      }

      if (typeof record?.sourceId === "string" && record.sourceId.trim()) {
        const previous = sourceLocations.get(record.sourceId);
        if (previous) {
          errors.push(`${label}: duplicate sourceId ${record.sourceId}; first seen in ${previous}`);
        } else {
          sourceLocations.set(record.sourceId, label);
        }
      }

      if (typeof record?.fullAnswer === "string" && record.fullAnswer.trim()) {
        const normalized = normalizedFullAnswer(record.fullAnswer);
        const previous = answerLocations.get(normalized);
        if (previous && previous.sourceId !== record.sourceId) {
          errors.push(
            `${label}: duplicate fullAnswer for sourceIds ${previous.sourceId} and ${record.sourceId}; first seen in ${previous.label}`,
          );
        } else if (!previous) {
          answerLocations.set(normalized, { sourceId: record.sourceId, label });
        }
      }
    }
  }
  return errors;
}

export function importAnswerBatches(databasePath, batchesPath) {
  const batches = loadBatchFiles(batchesPath);
  validateDatabaseFile(databasePath);
  const database = new DatabaseSync(databasePath);
  try {
    database.exec("PRAGMA foreign_keys = ON");
    const questionRows = database.prepare("SELECT id, source_id FROM questions").all();
    const sourceIds = new Set(questionRows.map(({ source_id: sourceId }) => sourceId));
    const questionIds = new Map(questionRows.map(({ id, source_id: sourceId }) => [sourceId, id]));
    const validationErrors = validateBatches(batches, sourceIds);
    if (validationErrors.length > 0) {
      throw new Error(`answer batch validation failed:\n${validationErrors.join("\n")}`);
    }

    const upsertAnswer = database.prepare(`
      INSERT INTO answers (
        question_id, short_answer, full_answer, pitfalls, answer_origin, review_status
      ) VALUES (?, ?, ?, ?, '原创整理', 'draft')
      ON CONFLICT(question_id) DO UPDATE SET
        short_answer = excluded.short_answer,
        full_answer = excluded.full_answer,
        pitfalls = excluded.pitfalls,
        answer_origin = '原创整理',
        review_status = 'draft'
    `);
    const updateQuestion = database.prepare("UPDATE questions SET difficulty = ?, context_note = ? WHERE id = ?");
    const deleteFollowUps = database.prepare("DELETE FROM follow_ups WHERE question_id = ?");
    const insertFollowUp = database.prepare(
      "INSERT INTO follow_ups (question_id, position, question, answer) VALUES (?, ?, ?, ?)",
    );
    const deleteTags = database.prepare("DELETE FROM tags WHERE question_id = ?");
    const insertTag = database.prepare("INSERT INTO tags (question_id, tag) VALUES (?, ?)");
    const deleteReviews = database.prepare("DELETE FROM answer_reviews WHERE question_id = ?");
    const upsertReview = database.prepare(`
      INSERT INTO answer_reviews (question_id, batch, status, notes, reviewed_at)
      VALUES (?, ?, 'pending', '', NULL)
      ON CONFLICT(question_id, batch) DO UPDATE SET
        status = 'pending', notes = '', reviewed_at = NULL
    `);

    database.exec("BEGIN IMMEDIATE");
    try {
      for (const { batchId, records } of batches) {
        for (const record of records) {
          const questionId = questionIds.get(record.sourceId);
          deleteReviews.run(questionId);
          updateQuestion.run(record.difficulty, record.contextNote ?? "", questionId);
          upsertAnswer.run(questionId, record.shortAnswer.trim(), record.fullAnswer.trim(), JSON.stringify(record.pitfalls));

          deleteFollowUps.run(questionId);
          for (const [index, followUp] of record.followUps.entries()) {
            insertFollowUp.run(questionId, index + 1, followUp.question.trim(), followUp.answer.trim());
          }

          deleteTags.run(questionId);
          for (const tag of record.tags) {
            insertTag.run(questionId, tag.trim());
          }
          upsertReview.run(questionId, batchId);
        }
      }
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  } finally {
    database.close();
  }

  return batches.reduce((total, { records }) => total + records.length, 0);
}

const isMainModule = process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (isMainModule) {
  try {
    const { databasePath, batchesPath } = parseArguments(process.argv.slice(2));
    const imported = importAnswerBatches(databasePath, batchesPath);
    console.log(`imported ${imported} answer records from ${batchesPath}`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
