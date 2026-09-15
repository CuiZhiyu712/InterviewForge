import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const outputDir = new URL("../dist/library/", import.meta.url);
const readJson = async (name) => JSON.parse(await readFile(new URL(`data/${name}.json`, outputDir), "utf8"));
const hasAnswer = (answer) => answer.replace(/^ +| +$/g, "").length > 0;
const byName = (left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0);

const pages = ["index.html", "learn.html", "practice.html", "sources.html"];
const loaderTag = "js/static-fetch.js";
for (const name of pages) {
  const html = await readFile(new URL(name, outputDir), "utf8");
  const moduleScripts = [...html.matchAll(/<script type="module" src="([^"]+)"><\/script>/g)].map((match) => match[1]);
  assert.equal(moduleScripts[0], loaderTag, `${name} must boot the snapshot loader before the page script`);
  assert.doesNotMatch(html, /href="\/"/, `${name} must not link to the site root`);
}

const [repositories, documents, questions, stats, modules, sources] = await Promise.all(
  ["repositories", "documents", "questions", "stats", "modules", "sources"].map(readJson),
);

// The snapshot has to carry every column of every table, not just the columns the API projects.
const columns = {
  repositories: ["id", "name", "url", "commit_hash", "license_text", "imported_at"],
  documents: ["id", "repository_id", "module", "title", "relative_path", "markdown"],
  questions: ["id", "document_id", "repository_id", "module", "question", "answer", "relative_path"],
};
for (const [table, rows] of Object.entries({ repositories, documents, questions })) {
  assert.ok(rows.length > 0, `${table} must not be empty`);
  for (const row of rows) assert.deepEqual(Object.keys(row), columns[table], `${table} row ${row.id} lost a column`);
}

// A record per line is what keeps snapshot churn out of the diff headers.
for (const [table, rows] of Object.entries({ repositories, documents, questions })) {
  const text = await readFile(new URL(`data/${table}.json`, outputDir), "utf8");
  const lines = text.split("\n").filter((line) => line.length > 0);
  assert.equal(lines.length, rows.length + 2, `${table}.json must hold exactly one record per line`);
  assert.equal(lines[0], "[");
  assert.equal(lines.at(-1), "]");
  for (const line of lines.slice(1, -1)) assert.doesNotThrow(() => JSON.parse(line.replace(/,$/, "")), `${table}.json record must be self-contained on one line`);
}

assert.deepEqual(stats, {
  repositories: repositories.length,
  documents: documents.length,
  questions: questions.length,
  answeredQuestions: questions.filter((row) => hasAnswer(row.answer)).length,
});

const questionCounts = new Map();
for (const row of questions) questionCounts.set(row.module, (questionCounts.get(row.module) || 0) + 1);
const documentCounts = new Map();
for (const row of documents) documentCounts.set(row.module, (documentCounts.get(row.module) || 0) + 1);
assert.deepEqual(modules, [...documentCounts.entries()]
  .map(([module, count]) => ({ module, documents: count, questions: questionCounts.get(module) || 0 }))
  .sort((left, right) => right.documents - left.documents
    || (left.module < right.module ? -1 : left.module > right.module ? 1 : 0)));

const countBy = (rows, key) => {
  const counts = new Map();
  for (const row of rows) counts.set(row[key], (counts.get(row[key]) || 0) + 1);
  return counts;
};
const documentsByRepository = countBy(documents, "repository_id");
const questionsByRepository = countBy(questions, "repository_id");
assert.deepEqual(sources, [...repositories].sort(byName).map((row) => ({
  ...row,
  documents: documentsByRepository.get(row.id) || 0,
  questions: questionsByRepository.get(row.id) || 0,
})));

console.log(`library export ok: ${repositories.length} repositories, ${documents.length} documents, ${questions.length} questions`);
