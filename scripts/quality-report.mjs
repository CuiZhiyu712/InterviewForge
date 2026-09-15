import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const database = new DatabaseSync(resolve(root, "data", "interview_bank.sqlite"), { readOnly: true });
const normalize = (text) => text.toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, "");
const ngrams = (text, size = 3) => {
  const normalized = normalize(text);
  const values = new Set();
  for (let index = 0; index <= normalized.length - size; index += 1) values.add(normalized.slice(index, index + size));
  return values;
};
const jaccard = (left, right) => {
  let intersection = 0;
  for (const value of left) if (right.has(value)) intersection += 1;
  return intersection / (left.size + right.size - intersection || 1);
};
let report;
try {
  const totals = database.prepare(`
    SELECT
      (SELECT COUNT(*) FROM questions) questions,
      (SELECT COUNT(*) FROM answers) answers,
      (SELECT COUNT(*) FROM questions q LEFT JOIN answers a ON a.question_id=q.id WHERE a.question_id IS NULL) missingAnswers,
      (SELECT COUNT(*) FROM (SELECT full_answer FROM answers GROUP BY full_answer HAVING COUNT(*)>1)) exactDuplicateAnswers,
      (SELECT COUNT(*) FROM follow_ups) followUps,
      (SELECT COUNT(*) FROM tags) tags,
      (SELECT COUNT(*) FROM questions WHERE resume_focus=1) resumeFocus
  `).get();
  const modules = database.prepare(`
    SELECT q.module, COUNT(*) questions,
      ROUND(AVG(length(a.full_answer)), 1) averageAnswerLength,
      MIN(length(a.full_answer)) minimumAnswerLength,
      SUM(CASE WHEN q.difficulty='基础' THEN 1 ELSE 0 END) basic,
      SUM(CASE WHEN q.difficulty='中等' THEN 1 ELSE 0 END) intermediate,
      SUM(CASE WHEN q.difficulty='进阶' THEN 1 ELSE 0 END) advanced,
      SUM(CASE WHEN q.context_note<>'' THEN 1 ELSE 0 END) contextNotes,
      SUM(CASE WHEN q.resume_focus=1 THEN 1 ELSE 0 END) resumeFocus
    FROM questions q JOIN answers a ON a.question_id=q.id
    GROUP BY q.module ORDER BY questions DESC, q.module
  `).all();
  const reviewStatus = database.prepare("SELECT status, COUNT(*) count FROM answer_reviews GROUP BY status ORDER BY status").all();
  const priority = database.prepare("SELECT COALESCE(priority, '非重点') priority, COUNT(*) count FROM questions GROUP BY priority ORDER BY priority").all();
  const answers = database.prepare(`
    SELECT q.source_id sourceId, q.question, a.short_answer shortAnswer, a.full_answer fullAnswer
    FROM questions q JOIN answers a ON a.question_id=q.id ORDER BY q.source_id
  `).all();
  const placeholderPattern = /(?:待补充|TODO|TBD|只是目录标题|暂无答案|无法回答)/i;
  const placeholderCandidates = answers.filter((row) =>
    row.shortAnswer.length < 15 || row.fullAnswer.length < 120 || placeholderPattern.test(`${row.shortAnswer} ${row.fullAnswer}`),
  ).map((row) => ({ sourceId: row.sourceId, question: row.question, shortLength: row.shortAnswer.length, fullLength: row.fullAnswer.length }));

  const signatures = answers.map((row) => ({ ...row, grams: ngrams(row.fullAnswer), normalizedLength: normalize(row.fullAnswer).length }));
  const nearDuplicateCandidates = [];
  for (let leftIndex = 0; leftIndex < signatures.length; leftIndex += 1) {
    const left = signatures[leftIndex];
    for (let rightIndex = leftIndex + 1; rightIndex < signatures.length; rightIndex += 1) {
      const right = signatures[rightIndex];
      const lengthRatio = Math.min(left.normalizedLength, right.normalizedLength) / Math.max(left.normalizedLength, right.normalizedLength);
      if (lengthRatio < 0.82) continue;
      const similarity = jaccard(left.grams, right.grams);
      if (similarity >= 0.88) nearDuplicateCandidates.push({ left: left.sourceId, right: right.sourceId, similarity: Number(similarity.toFixed(3)) });
    }
  }
  nearDuplicateCandidates.sort((left, right) => right.similarity - left.similarity);

  const sentenceUses = new Map();
  for (const row of answers) {
    const uniqueSentences = new Set(row.fullAnswer.split(/[。！？!?；;]/).map((item) => item.trim()).filter((item) => normalize(item).length >= 18));
    for (const sentence of uniqueSentences) {
      const key = normalize(sentence);
      const entry = sentenceUses.get(key) ?? { sentence, sourceIds: [] };
      entry.sourceIds.push(row.sourceId);
      sentenceUses.set(key, entry);
    }
  }
  const templateCandidates = [...sentenceUses.values()]
    .filter((entry) => entry.sourceIds.length >= 5)
    .sort((left, right) => right.sourceIds.length - left.sourceIds.length)
    .map((entry) => ({ sentence: entry.sentence, count: entry.sourceIds.length, sourceIds: entry.sourceIds }));

  report = {
    generatedAt: new Date().toISOString(), totals, modules, priority, reviewStatus,
    auditThresholds: { shortAnswerMinimum: 15, fullAnswerMinimum: 120, nearDuplicateSimilarity: 0.88, templateSentenceMinimumUses: 5 },
    placeholderCandidates, nearDuplicateCandidates, templateCandidates,
  };
} finally {
  database.close();
}

mkdirSync(resolve(root, "reports"), { recursive: true });
writeFileSync(resolve(root, "reports", "content-quality.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
const lines = [
  "# 面试题库内容质量报告", "",
  `- 题目：${report.totals.questions.toLocaleString("zh-CN")}`,
  `- 完整答案：${report.totals.answers.toLocaleString("zh-CN")}`,
  `- 带答案追问：${report.totals.followUps.toLocaleString("zh-CN")}`,
  `- 缺失答案：${report.totals.missingAnswers}`,
  `- 完全重复答案：${report.totals.exactDuplicateAnswers}`,
  "", "## 模块统计", "",
  "| 模块 | 题数 | 平均答案长度 | 最短答案 | 简历重点 |",
  "|---|---:|---:|---:|---:|",
  ...report.modules.map((row) => `| ${row.module} | ${row.questions} | ${row.averageAnswerLength} | ${row.minimumAnswerLength} | ${row.resumeFocus} |`),
  "", "## 质量候选项", "",
  `- 占位或过短答案：${report.placeholderCandidates.length}`,
  `- 近似重复答案：${report.nearDuplicateCandidates.length}`,
  `- 模板化片段：${report.templateCandidates.length}`,
  ...(report.placeholderCandidates.length ? ["", "### 占位或过短答案", "", ...report.placeholderCandidates.slice(0, 30).map((row) => `- ${row.sourceId}：${row.question}（${row.shortLength}/${row.fullLength} 字）`)] : []),
  ...(report.nearDuplicateCandidates.length ? ["", "### 近似重复", "", ...report.nearDuplicateCandidates.slice(0, 30).map((row) => `- ${row.left} ↔ ${row.right}：${row.similarity}`)] : []),
  ...(report.templateCandidates.length ? ["", "### 模板化片段", "", ...report.templateCandidates.slice(0, 20).map((row) => `- ${row.count} 次：${row.sentence}（${row.sourceIds.slice(0, 8).join("、")}）`)] : []),
  "", "## 说明", "",
  "来源标题和精确链接来自公开目录；答案为独立原创整理，不复制来源正文。自动报告用于覆盖率与结构检查，不能替代对重点技术事实的人工复核。", "",
];
writeFileSync(resolve(root, "reports", "content-quality.md"), lines.join("\n"), "utf8");
console.log(`quality report: ${report.totals.answers}/${report.totals.questions} answers`);
