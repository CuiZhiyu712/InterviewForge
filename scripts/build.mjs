import { readFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sources = JSON.parse(await readFile(resolve(root, "data", "source-index.json"), "utf8"));
const resumePlan = JSON.parse(await readFile(resolve(root, "data", "resume-focus.json"), "utf8"));
const database = new DatabaseSync(resolve(root, "data", "interview_bank.sqlite"), { readOnly: true });
let questions;
try {
  const rows = database.prepare(`
    SELECT q.*, a.short_answer, a.full_answer, a.pitfalls, a.answer_origin, a.review_status
    FROM questions q JOIN answers a ON a.question_id=q.id ORDER BY q.source_id
  `).all();
  const followUpStatement = database.prepare("SELECT question, answer FROM follow_ups WHERE question_id=? ORDER BY position");
  const tagStatement = database.prepare("SELECT tag FROM tags WHERE question_id=? ORDER BY tag");
  questions = rows.map((row) => ({
    id: row.source_id, module: row.module, submodule: row.submodule,
    question: row.question, originalTitle: row.original_title,
    shortAnswer: row.short_answer, answer: row.full_answer,
    followUps: followUpStatement.all(row.id),
    pitfalls: JSON.parse(row.pitfalls), tags: tagStatement.all(row.id).map(({ tag }) => tag),
    difficulty: row.difficulty, resumeFocus: Boolean(row.resume_focus),
    priority: row.priority ?? "", resumeReason: row.resume_reason,
    contextNote: row.context_note, answerOrigin: row.answer_origin,
    reviewStatus: row.review_status,
    source: { name: row.source_site, url: row.source_url },
  }));
} finally {
  database.close();
}
if (questions.length !== 1200) throw new Error(`expected 1200 complete questions, received ${questions.length}`);
const template = await readFile(resolve(root, "src", "template.html"), "utf8");
const safe = (value) => JSON.stringify(value).replaceAll("<", "\\u003c");
const html = template
  .replace("__QUESTION_DATA__", safe(questions))
  .replace("__SOURCE_DATA__", safe(sources))
  .replace("__RESUME_DATA__", safe(resumePlan));

await mkdir(resolve(root, "dist"), { recursive: true });
await writeFile(resolve(root, "dist", "index.html"), html, "utf8");
console.log(`built dist/index.html with ${questions.length} complete authored answers`);
