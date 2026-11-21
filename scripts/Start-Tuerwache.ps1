[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
Push-Location $projectRoot
try {
    if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Install Node.js 24 LTS first: https://nodejs.org/' }
    $fileConfiguresPython = (Test-Path -LiteralPath '.env') -and ((Get-Content -LiteralPath '.env' -Raw) -match '(?m)^\s*AI_PYTHON\s*=')
    if (-not $env:AI_PYTHON -and -not $fileConfiguresPython -and (Test-Path -LiteralPath '.venv/Scripts/python.exe')) { $env:AI_PYTHON = Join-Path $projectRoot '.venv/Scripts/python.exe' }
    $nodeArguments = @()
    if (Test-Path -LiteralPath '.env') { $nodeArguments += '--env-file=.env' }
    $nodeArguments += 'src/server.mjs'
    & node @nodeArguments
    if ($LASTEXITCODE -ne 0) { throw "Server exited with code $LASTEXITCODE" }
} finally { Pop-Location }
