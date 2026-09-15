# InterviewForge Mobile Responsive Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让现有题库在手机上不被筛选栏遮挡，并将 P0 区域压缩为可按需展开的快捷入口。

**Architecture:** 继续使用单文件静态 HTML，以原生 `details` 承载渐进式展开；JavaScript 只负责移动端初始状态和 P0 快捷筛选，不引入依赖。

**Tech Stack:** HTML、CSS、原生 JavaScript、Node.js 静态测试

---

### Task 1: 添加响应式行为测试

**Files:**
- Modify: `tests/test-build.mjs`
- Modify: `tests/browser-check.mjs`

- [ ] 添加 P0 折叠、移动筛选面板、P0 快捷入口及移动端布局断言。
- [ ] 运行测试并确认因功能尚未实现而失败。

### Task 2: 实现移动端布局

**Files:**
- Modify: `src/template.html`

- [ ] 将 P0 和筛选区改为语义化折叠面板。
- [ ] 添加 P0 快捷筛选行为。
- [ ] 添加 900px 与 560px 移动端样式，移除移动端筛选吸顶。
- [ ] 构建并运行完整测试。

### Task 3: 发布

**Files:**
- Modify: `dist/index.html`

- [ ] 重新构建 1,200 题静态页面。
- [ ] 提交并推送到 `main`，确认 GitHub Pages 工作流成功。
