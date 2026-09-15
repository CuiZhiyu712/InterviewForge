import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const html = await readFile(new URL("../dist/index.html", import.meta.url), "utf8");

assert.match(html, /崔智宇.*面试题库/);
assert.match(html, /id="question-list"/);
assert.match(html, /id="random-mode"/);
assert.match(html, /id="resume-only"/);
assert.match(html, /id="priority-filter"/);
assert.match(html, /id="state-filter"/);
assert.match(html, /id="submodule-filter"/);
assert.match(html, /id="weak-only"/);
assert.match(html, /data-favorite/);
assert.match(html, /id="previous-random"/);
assert.match(html, /<details[^>]*class="answer-panel"/);
assert.match(html, /class="follow-up-answer"/);
assert.match(html, /localStorage/);
assert.match(html, /window\.__QUESTIONS__\s*=\s*\[/);
assert.match(html, /window\.__SOURCES__\s*=\s*\[/);
assert.match(html, /window\.__RESUME_PLAN__\s*=\s*\{/);
assert.match(html, /id="priority-roadmap"/);
assert.match(html, /<details[^>]+id="priority-roadmap"/);
assert.match(html, /id="filter-panel"/);
assert.match(html, /id="study-p0"/);
assert.match(html, /id="p0-count"/);
assert.match(html, /@media\(max-width:900px\)[\s\S]*?\.toolbar\{position:static/);
assert.doesNotMatch(html, /<script[^>]+src=/i, "must not depend on external scripts");
assert.doesNotMatch(html, /<link[^>]+href=["']https?:/i, "must not depend on external styles");
assert.doesNotMatch(html, /__QUESTION_DATA__|__SOURCE_DATA__|__RESUME_DATA__/);
assert.doesNotMatch(html, /目录项不冒充已撰写答案|全部公开来源目录/);
assert.match(html, /精确题目来源/);
assert.doesNotMatch(html, /innerHTML\s*\+=\s*\$\('#source-module'\)\.innerHTML\s*=/, "source module options must preserve the all-modules option");

const dataMatch = html.match(/<script>window\.__QUESTIONS__=(\[[\s\S]*?\]);window\.__SOURCES__/);
assert.ok(dataMatch, "embedded question data missing");
const questions = JSON.parse(dataMatch[1]);
assert.equal(questions.length, 1200);
for (const question of questions) {
  assert.ok(question.shortAnswer && question.answer && question.source?.url);
  assert.ok(Array.isArray(question.pitfalls) && question.pitfalls.length > 0);
  assert.ok(Array.isArray(question.followUps) && question.followUps.length >= 2);
  assert.ok(question.followUps.every((item) => item.question && item.answer));
}

console.log(`build ok: ${html.length} bytes`);
