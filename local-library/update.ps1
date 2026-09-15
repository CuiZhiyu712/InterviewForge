$ErrorActionPreference = "Stop"
$libraryRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$sourcesRoot = Join-Path $libraryRoot "sources"

Get-ChildItem -LiteralPath $sourcesRoot -Directory | ForEach-Object {
    Write-Host "更新 $($_.Name)" -ForegroundColor Cyan
    & git -C $_.FullName pull --ff-only
    if ($LASTEXITCODE -ne 0) { throw "更新 $($_.Name) 失败" }
}

& node --disable-warning=ExperimentalWarning (Join-Path $libraryRoot "server\importer.mjs")
if ($LASTEXITCODE -ne 0) { throw "重新导入失败" }
Write-Host "8 个开源仓库已更新并重新导入。" -ForegroundColor Green
