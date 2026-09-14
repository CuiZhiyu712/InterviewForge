# Full Answer Database Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 1,200 条来源全部转换为具有原创分层答案的 SQLite 题库，并从数据库生成单文件离线刷题 HTML。

**Architecture:** `source-index.json` 保持抓取快照；按领域生成的 JSON 批次通过严格校验后导入 `interview_bank.sqlite`。Node.js 使用内置 `node:sqlite` 读写数据库，构建脚本查询数据库并把全部问答嵌入静态 HTML。

**Tech Stack:** Node.js 24、`node:sqlite`、SQLite、HTML5、CSS、原生 JavaScript、Node assert 测试。

---

### Task 1: 建立数据库模式与来源导入

**Files:**
- Create: `scripts/create-database.mjs`
- Create: `tests/test-database.mjs`
- Create: `data/interview_bank.sqlite`
- Modify: `package.json`

- [ ] 编写失败测试：打开数据库并要求 `questions`、`answers`、`follow_ups`、`tags`、`answer_reviews` 五张表存在，`questions` 数量为 1,200，外键检查为空。
- [ ] 运行 `node tests/test-database.mjs`，确认因数据库不存在而失败。
- [ ] 在 `create-database.mjs` 中使用 `DatabaseSync`，事务内创建表、索引和枚举 `CHECK` 约束，并把 `source-index.json` 全量写入 `questions`。
- [ ] 将文章型标题规范化为问句，但始终保留 `original_title`；暂时允许答案表为空，以便内容分批导入。
- [ ] 运行数据库测试，确认模式、1,200 条来源、一一对应与外键完整性通过。
- [ ] 提交 `feat: add sqlite question database`。

### Task 2: 建立答案批次格式与质量闸门

**Files:**
- Create: `scripts/lib/answer-validation.mjs`
- Create: `scripts/import-answer-batches.mjs`
- Create: `tests/test-answer-validation.mjs`
- Create: `data/answer-batches/.gitkeep`

- [ ] 先测试一个合法样例和以下非法样例：缺少一句话答案、完整答案过短、少于两个追问、追问无答案、无易错点、来源 ID 不存在、占位词、批次内重复 ID。
- [ ] 运行测试并确认校验器尚不存在。
- [ ] 实现 `validateAnswerRecord(record, sourceIds)`，返回具体错误数组；`fullAnswer` 最少 80 个中文字符或 45 个非空白词，追问数量为 2–3。
- [ ] 实现导入器：先验证全部批次，再在单个事务中 upsert `answers`、重建 `follow_ups`/`tags`、写入 `answer_reviews`；任一错误则不写数据库。
- [ ] 增加跨题完全重复答案检测与占位词正则，输出题号和批次名。
- [ ] 运行测试并提交 `feat: validate and import answer batches`。

### Task 3: 编写 Java 与工程答案批次

**Files:**
- Create: `data/answer-batches/java-core.json`
- Create: `data/answer-batches/java-concurrency-jvm.json`
- Create: `data/answer-batches/spring-distributed-mq.json`

- [ ] 按 `source_id` 分配 Java基础、集合、并发、JVM、Spring、消息队列、分布式系统及企业面经中的相应题目，确保不与其他批次重叠。
- [ ] 每题写入 `shortAnswer`、`fullAnswer`、`followUps[{question,answer}]`、`pitfalls[]`、`tags[]`、`difficulty`、`contextNote`。
- [ ] 对上下文缺失的企业面经题明确假设，不虚构面试公司或项目事实。
- [ ] 运行批次校验，修复所有空泛模板、完全重复或过短答案。
- [ ] 提交 `content: add java and engineering answers`。

### Task 4: 编写系统与数据答案批次

**Files:**
- Create: `data/answer-batches/network-os.json`
- Create: `data/answer-batches/mysql-redis.json`
- Create: `data/answer-batches/data-structure-other.json`

- [ ] 覆盖计算机网络、操作系统、MySQL、Redis、数据结构及尚未归入工程批次的后端题目。
- [ ] 对版本相关问题使用稳定机制表述；无法保证时效的默认值或命令行为明确标注需以当前版本为准。
- [ ] 追问答案必须给出结论，不只重复问题。
- [ ] 运行批次校验并提交 `content: add systems and data answers`。

### Task 5: 编写 LLM、RAG、Agent 与框架答案批次

**Files:**
- Create: `data/answer-batches/llm-rag.json`
- Create: `data/answer-batches/agent-tools.json`
- Create: `data/answer-batches/llm-engineering-frameworks.json`

- [ ] 覆盖小林面试笔记的 106 条以及来源索引中的所有 AI 相关条目。
- [ ] 答案区分模型原理、应用工程和框架 API；对易变化的框架接口使用概念级回答并提示版本差异。
- [ ] Tool Calling、MCP、RAG、Agent 安全问题必须包含权限边界、失败处理或评测指标。
- [ ] 运行批次校验并提交 `content: add llm and agent answers`。

### Task 6: 合并原有核心题与简历优先级

**Files:**
- Create: `scripts/map-resume-priority.mjs`
- Create: `tests/test-resume-priority.mjs`
- Modify: `data/interview_bank.sqlite`

- [ ] 编写失败测试，要求 P0/P1/P2 均非空，P0 至少覆盖设计文档列出的九个主题，简历重点记录均有 `resume_reason`。
- [ ] 将原有 87 道题按标题/标签匹配到最接近来源记录；找不到精确来源的简历原创题作为独立覆盖规则写回相关来源题，而不增加总题数。
- [ ] 使用 `resume-focus.json` 关键词与人工覆盖映射写入优先级和理由。
- [ ] 重点题复核答案，确保未部署、Mock、未来规划与已实现能力区分清楚。
- [ ] 运行测试并提交 `feat: map resume priorities into database`。

### Task 7: 全量数据库质量报告

**Files:**
- Create: `scripts/quality-report.mjs`
- Create: `tests/test-full-coverage.mjs`
- Create: `reports/content-quality.json`
- Create: `reports/content-quality.md`

- [ ] 编写失败测试，要求题目、答案均为 1,200；每题 2–3 个追问；来源 URL 精确一致；无孤儿记录、空字段、完全重复完整答案或占位符。
- [ ] 实现报告：按模块统计题数、答案长度、难度、优先级、上下文假设、近似答案候选和复核状态。
- [ ] 对近似答案候选抽样复核；确属不同问法的共享事实可以保留，但修改空泛模板化表达。
- [ ] 运行 `node tests/test-full-coverage.mjs` 和 `node scripts/quality-report.mjs`，确认覆盖率 1,200/1,200。
- [ ] 提交 `test: verify full answer coverage`。

### Task 8: 从 SQLite 构建全量离线 HTML

**Files:**
- Modify: `scripts/build.mjs`
- Modify: `src/template.html`
- Modify: `tests/test-build.mjs`
- Modify: `tests/browser-check.mjs`
- Modify: `dist/index.html`

- [ ] 先修改测试，要求构建数据为 1,200 道且每题包含易错点和带答案追问；页面不再出现“来源目录无答案”的旧文案。
- [ ] 运行构建测试，确认旧页面因仅含 87 道完整答案而失败。
- [ ] 修改构建脚本直接查询 SQLite，序列化题目、答案、追问、标签和优先级。
- [ ] 修改题卡：主答案默认折叠，追问答案二级折叠，展示易错点、精确来源、上下文说明和原创标记。
- [ ] 保留模块/难度/状态/优先级/收藏/搜索/随机/上一题/下一题，增加子模块筛选与仅抽不会/模糊题。
- [ ] 构建并运行全部静态与浏览器脚本检查。
- [ ] 提交 `feat: build full offline answer bank from sqlite`。

### Task 9: 文档、独立复核与发布

**Files:**
- Modify: `README.md`
- Modify: `SOURCE_POLICY.md`
- Create: `output/崔智宇-Java后端与大模型应用面试题库.html`

- [ ] 更新 README 为 1,200 道完整答案、数据库维护命令、构建和测试说明。
- [ ] 独立复核 P0/P1、技术争议题、来源边界和页面交互；修复全部 Critical/Important。
- [ ] 运行 `npm test`、SQLite `integrity_check`、内容质量报告、构建和 `git diff --check`。
- [ ] 复制最终 HTML 到 `output`，验证与 `dist/index.html` SHA-256 一致。
- [ ] 提交 `docs: document full interview database` 并推送远程 `main`。
