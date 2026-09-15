# 崔智宇｜Java 后端与大模型应用面试题库

一个无需服务器、双击即可使用的单文件面试题库，面向大模型应用开发日常实习。

## 内容

- 1,200 道完整原创参考答案，覆盖 Java 后端、网络、操作系统、MySQL、Redis、LLM、RAG、Agent、MCP、SSE 和框架。
- 每题包含一句话结论、1–3 分钟回答、两个带答案追问、易错点和精确来源。
- 模块/子模块刷题、随机刷题、难度与 P0/P1/P2 筛选、收藏、错题和本地学习进度。
- SQLite 数据库是内容主数据源；最终 HTML 已嵌入全部数据，双击使用时不需要安装数据库。

## 使用

直接打开 `dist/index.html`。学习状态保存在浏览器 `localStorage`，文件不会上传数据。

数据库与构建流程（Node.js 24）：

```powershell
npm run sources
npm run db:create
npm run answers:import
npm run priority:map
npm run quality
npm run build
npm test
```

## 来源与边界

来源目录来自小林 Coding 与小林面试笔记在 2026-09-14 可访问的公开页面。项目仅整理公开标题与原页面链接，不复制原文答案、图片或付费内容；全部答案均为本项目独立撰写。请通过每道题的精确来源链接阅读原作者内容。
