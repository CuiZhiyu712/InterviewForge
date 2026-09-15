import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const report = JSON.parse(await readFile(new URL("../reports/content-quality.json", import.meta.url), "utf8"));
const markdown = await readFile(new URL("../reports/content-quality.md", import.meta.url), "utf8");
assert.equal(report.totals.questions, 1200);
assert.equal(report.totals.answers, 1200);
assert.equal(report.totals.missingAnswers, 0);
assert.equal(report.totals.exactDuplicateAnswers, 0);
assert.ok(Array.isArray(report.modules) && report.modules.length >= 20);
assert.ok(Array.isArray(report.placeholderCandidates), "placeholder candidate list missing");
assert.ok(Array.isArray(report.nearDuplicateCandidates), "near-duplicate candidate list missing");
assert.ok(Array.isArray(report.templateCandidates), "template candidate list missing");
assert.ok(report.auditThresholds?.nearDuplicateSimilarity, "audit thresholds missing");
assert.match(markdown, /1,200/);
assert.match(markdown, /模块统计/);
assert.match(markdown, /质量候选项/);
assert.match(markdown, /近似重复|模板化片段/);
console.log("quality report ok");
