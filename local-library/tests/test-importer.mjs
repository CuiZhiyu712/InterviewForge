import assert from "node:assert/strict";
import { classifyModule, extractDocument, shouldImportFile } from "../server/importer.mjs";

const markdown = `# 什么是 RAG？

RAG 将检索结果放入模型上下文，再生成有依据的回答。

## 为什么需要重排？

向量召回优化相关性，重排模型进一步比较查询与候选段落。

## 普通章节

这里是补充知识。`;

const result = extractDocument({ repository: "demo", relativePath: "docs/rag.md", markdown });
assert.equal(result.title, "什么是 RAG？");
assert.equal(result.sections.length, 3);
assert.equal(result.questions.length, 2);
assert.equal(result.questions[0].question, "什么是 RAG？");
assert.match(result.questions[0].answer, /检索结果/);
assert.equal(result.questions[1].question, "为什么需要重排？");
assert.match(result.questions[1].answer, /重排模型/);

const duplicate = extractDocument({ repository: "demo", relativePath: "docs/rag-copy.md", markdown });
assert.equal(duplicate.questions.length, 2, "same question in another file must be preserved");
assert.equal(classifyModule("docs/database/mysql-index.md", "索引为什么使用 B+ 树？"), "MySQL");
assert.equal(classifyModule("docs/agent/tool-use.md", "Agent 如何调用工具？"), "Agent");
assert.equal(shouldImportFile("JavaGuide", "docs/about-the-author/README.md"), false);
assert.equal(shouldImportFile("JavaGuide", "README_EN.md"), false);
assert.equal(shouldImportFile("LLMInterviewQuestions", "README.md"), true);
assert.equal(shouldImportFile("agent-interview-100", "01-agent-architecture/001-what-is-llm-agent.md"), true);
console.log("importer unit tests passed");
