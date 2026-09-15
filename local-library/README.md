# InterviewForge Local

本地开源知识学习与刷题系统。内容来自8个开源仓库，原文未经技术审查；系统不做语义去重或答案改写。

## 启动

双击 `start.ps1`，或在 PowerShell 中运行：

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\start.ps1
```

然后访问 <http://localhost:4173>。关闭运行窗口即可停止服务器。

## 更新开源内容

服务器停止后运行：

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\update.ps1
```

更新脚本会对8个仓库执行 `git pull --ff-only`，成功后重新生成 SQLite。

## 页面

- `/index.html`：仓库、文档、问题和模块统计。
- `/learn.html`：知识学习区，按模块与来源分页阅读完整 Markdown。
- `/practice.html`：刷题区，答案折叠、随机一页、学习状态和“只看有答案”。
- `/sources.html`：仓库提交版本和许可证原文。

## 数据边界

- 数据库：`data/open-source.sqlite`
- 原仓库：`sources/`
- 整个 `local-library/` 已写入父仓库 `.git/info/exclude`，不会进入父仓库提交。
- 各来源内容的使用条件以对应仓库许可证和说明为准。
