$ErrorActionPreference = "Stop"
$libraryRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$databasePath = Join-Path $libraryRoot "data\open-source.sqlite"

if (-not (Test-Path -LiteralPath $databasePath)) {
    Write-Host "首次运行：正在导入开源知识库……" -ForegroundColor Cyan
    & node --disable-warning=ExperimentalWarning (Join-Path $libraryRoot "server\importer.mjs")
}

Write-Host "InterviewForge Local 已启动" -ForegroundColor Green
Write-Host "电脑访问：http://localhost:4173"
Write-Host "关闭本窗口即可停止服务器。"
Start-Process "http://localhost:4173"
& node --disable-warning=ExperimentalWarning (Join-Path $libraryRoot "server\server.mjs")
