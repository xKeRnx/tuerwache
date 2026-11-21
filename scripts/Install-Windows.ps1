[CmdletBinding()]
param([switch]$WithAI, [switch]$CheckOnly)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
function Invoke-Checked([string]$Program, [string[]]$Arguments) {
    & $Program @Arguments
    if ($LASTEXITCODE -ne 0) { throw "$Program failed with exit code $LASTEXITCODE" }
}
Push-Location $projectRoot
try {
    if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Install Node.js 24 LTS from https://nodejs.org/ and reopen PowerShell.' }
    $nodeVersion = & node -p 'process.versions.node'
    if ($LASTEXITCODE -ne 0) { throw 'Cannot execute Node.js.' }
    $nodeMajor = [int]($nodeVersion.Trim().Split('.')[0])
    if ($nodeMajor -notin @(22,24)) { throw 'This release supports Node.js 22 or 24. Use Node.js 24 LTS.' }
    if (-not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) { throw 'npm.cmd is missing.' }
    $pythonProgram = $null
    $pythonPrefix = @()
    if ($WithAI) {
        if (Get-Command py -ErrorAction SilentlyContinue) { $pythonProgram = 'py'; $pythonPrefix = @('-3.12') }
        elseif (Get-Command python -ErrorAction SilentlyContinue) { $pythonProgram = 'python' }
        else { throw 'Install Python 3.12 from https://www.python.org/downloads/windows/ for local AI.' }
        Invoke-Checked $pythonProgram ($pythonPrefix + @('-c',"import sys; assert (3,10) <= sys.version_info[:2] <= (3,13), 'Python 3.10-3.13 required'; print(sys.version.split()[0])"))
    }
    Write-Output "Project: $projectRoot | Node: $nodeMajor | AI: $WithAI"
    if ($CheckOnly) { Write-Output 'Checks passed. No files changed, no downloads, no service started.'; return }
    if (Get-NetTCPConnection -LocalPort 3210 -State Listen -ErrorAction SilentlyContinue) { throw 'Stop the existing server on port 3210 before installing/updating.' }
    Invoke-Checked 'npm.cmd' @('ci','--omit=dev')
    Invoke-Checked 'node' @('node_modules/ffmpeg-for-homebridge/install.js')
    if ($WithAI) {
        if (-not (Test-Path -LiteralPath '.venv/Scripts/python.exe')) { Invoke-Checked $pythonProgram ($pythonPrefix + @('-m','venv','.venv')) }
        $venvPython = Join-Path $projectRoot '.venv/Scripts/python.exe'
        Invoke-Checked $venvPython @('-m','pip','install','--only-binary=:all:','-r','ai/requirements.txt')
        Invoke-Checked $venvPython @('ai/install-models.py')
        Invoke-Checked $venvPython @('-c',"import cv2, numpy; print('OpenCV', cv2.__version__)" )
    }
    Write-Output 'Installed. Start with .\scripts\Start-Tuerwache.ps1, then open http://127.0.0.1:3210. External access remains off.'
} finally { Pop-Location }
