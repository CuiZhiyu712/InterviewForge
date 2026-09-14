import assert from "node:assert/strict";
import { questions } from "../data/questions.js";

assert.ok(Array.isArray(questions) && questions.length >= 87, "question bank must contain at least 87 questions");

const ids = new Set();
const requiredModules = new Set(["计算机网络", "操作系统", "MySQL", "Redis", "Java工程", "LLM", "RAG", "Agent", "工具与协议", "大模型工程", "框架", "简历专项"]);
const seenModules = new Set();

for (const q of questions) {
  assert.ok(q.id && q.module && q.submodule && q.question, "identity fields must be complete");
  assert.ok(q.shortAnswer && q.answer && Array.isArray(q.followUps) && q.followUps.length > 0, `answers missing: ${q.id}`);
  assert.ok(["基础", "中等", "进阶"].includes(q.difficulty), `invalid difficulty: ${q.id}`);
  assert.ok(Array.isArray(q.tags) && q.tags.length > 0, `tags missing: ${q.id}`);
  assert.ok(q.source?.name && q.source?.url, `source missing: ${q.id}`);
  assert.ok(!ids.has(q.id), `duplicate question id: ${q.id}`);
  ids.add(q.id);
  seenModules.add(q.module);
  if (q.resumeFocus) {
    assert.ok(q.resumeReason, `resume reason missing: ${q.id}`);
    assert.ok(["P0", "P1", "P2"].includes(q.priority), `resume priority missing: ${q.id}`);
  }
}

for (const module of requiredModules) assert.ok(seenModules.has(module), `required module missing: ${module}`);
assert.ok(questions.filter((q) => q.resumeFocus).length >= 20, "at least 20 resume-focus questions required");
assert.ok(questions.filter((q) => q.priority === "P0").length >= 15, "at least 15 P0 questions required");
for (const topic of ["求职定位", "真实性", "业务闭环"]) {
  assert.ok(questions.some((q) => q.question.includes(topic)), `resume P0 topic missing: ${topic}`);
}

console.log(`questions ok: ${questions.length} questions, ${seenModules.size} modules`);
