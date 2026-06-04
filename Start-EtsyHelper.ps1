$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $projectRoot

if (-not (Test-Path (Join-Path $projectRoot 'package.json'))) {
  throw "Could not find package.json in $projectRoot"
}

if (-not (Test-Path (Join-Path $projectRoot 'node_modules'))) {
  Write-Host 'Installing dependencies for EtsyHelper...' -ForegroundColor Yellow
  npm install
}

Write-Host 'Starting EtsyHelper from the correct project folder...' -ForegroundColor Cyan
Write-Host 'If port 3000 is busy, the app will automatically move to the next open port.' -ForegroundColor DarkGray

npm run dev
