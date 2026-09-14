import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const html = await readFile(new URL("../dist/index.html", import.meta.url), "utf8");

assert.match(html, /崔智宇.*面试题库/);
assert.match(html, /id="question-list"/);
assert.match(html, /id="random-mode"/);
assert.match(html, /id="resume-only"/);
assert.match(html, /id="priority-filter"/);
assert.match(html, /id="state-filter"/);
assert.match(html, /data-favorite/);
assert.match(html, /id="previous-random"/);
assert.match(html, /id="source-catalog"/);
assert.match(html, /<details[^>]*class="answer-panel"/);
assert.match(html, /localStorage/);
assert.match(html, /window\.__QUESTIONS__\s*=\s*\[/);
assert.match(html, /window\.__SOURCES__\s*=\s*\[/);
assert.match(html, /window\.__RESUME_PLAN__\s*=\s*\{/);
assert.match(html, /id="priority-roadmap"/);
assert.doesNotMatch(html, /<script[^>]+src=/i, "must not depend on external scripts");
assert.doesNotMatch(html, /<link[^>]+href=["']https?:/i, "must not depend on external styles");
assert.doesNotMatch(html, /__QUESTION_DATA__|__SOURCE_DATA__|__RESUME_DATA__/);
assert.match(html, /相关公开目录（非逐题引用）/);
assert.doesNotMatch(html, /innerHTML\s*\+=\s*\$\('#source-module'\)\.innerHTML\s*=/, "source module options must preserve the all-modules option");

console.log(`build ok: ${html.length} bytes`);
