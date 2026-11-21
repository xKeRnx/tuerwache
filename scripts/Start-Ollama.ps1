param([switch]$Install, [ValidatePattern('^[a-zA-Z0-9][a-zA-Z0-9_.:/-]{0,159}$')][string]$Model = 'qwen2.5vl:3b')
$ErrorActionPreference = 'Stop'
if ($Model -match '(^|[-:/])cloud($|[-:/])') { throw 'Nur ein lokales Modell ist erlaubt.' }
$projectRoot = [IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
$runtimeRoot = Join-Path $projectRoot '.runtime\ollama'
$executable = Join-Path $runtimeRoot 'ollama.exe'
$modelRoot = Join-Path $projectRoot 'data\ollama-models'
New-Item -ItemType Directory -Path $modelRoot -Force | Out-Null
if (-not (Test-Path -LiteralPath $executable)) {
    if (-not $Install) { throw 'Ollama fehlt. Zuerst scripts\Start-Ollama.ps1 -Install ausführen.' }
    $drive = Get-PSDrive -Name ([IO.Path]::GetPathRoot($projectRoot).Substring(0,1))
    if ($drive.Free -lt 16GB) { throw 'Für Ollama-Laufzeit, Download und Bildmodell werden mindestens 16 GB freier Speicher verlangt.' }
    $release = Invoke-RestMethod -Uri 'https://api.github.com/repos/ollama/ollama/releases/latest'
    $asset = $release.assets | Where-Object { $_.name -eq 'ollama-windows-amd64.zip' } | Select-Object -First 1
    if (-not $asset -or $release.tag_name -notmatch '^v[0-9]+\.[0-9]+\.[0-9]+$' -or $asset.browser_download_url -notlike 'https://github.com/ollama/ollama/releases/download/*/ollama-windows-amd64.zip') { throw 'Offizielle Windows-Laufzeit nicht gefunden.' }
    $expected = if ($asset.digest -match '^sha256:([a-f0-9]{64})$') { $Matches[1] } else { '' }
    if (-not $expected) {
        $checksums = Invoke-RestMethod -Uri "https://github.com/ollama/ollama/releases/download/$($release.tag_name)/sha256sum.txt"
        $match = [regex]::Match([string]$checksums, '(?m)^([a-fA-F0-9]{64})\s+\*?ollama-windows-amd64\.zip\s*$')
        $expected = $match.Groups[1].Value.ToLowerInvariant()
    }
    if (-not $expected) { throw 'Offizielle SHA-256-Prüfsumme fehlt.' }
    $downloadRoot = Join-Path $projectRoot '.runtime\downloads'
    New-Item -ItemType Directory -Path $downloadRoot -Force | Out-Null
    $archive = Join-Path $downloadRoot ($release.tag_name+'-ollama-windows-amd64.zip')
    if (-not (Test-Path -LiteralPath $archive) -or (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expected) {
        Write-Output "Lade offizielle Ollama-Laufzeit $($release.tag_name) ($([math]::Round($asset.size/1GB,2)) GB)."
        & curl.exe --fail --location --retry 2 --output $archive $asset.browser_download_url
        if ($LASTEXITCODE -ne 0) { throw 'Ollama-Download fehlgeschlagen.' }
    }
    if ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expected) { throw 'Ollama-SHA-256 stimmt nicht überein.' }
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $zip = [IO.Compression.ZipFile]::OpenRead($archive)
    try {
        $safePrefix = [IO.Path]::GetFullPath($runtimeRoot).TrimEnd('\')+'\'
        foreach ($entry in $zip.Entries) {
            $target = [IO.Path]::GetFullPath((Join-Path $runtimeRoot $entry.FullName))
            if (-not $target.StartsWith($safePrefix, [StringComparison]::OrdinalIgnoreCase)) { throw 'Unsicherer Pfad im Ollama-Archiv.' }
        }
    } finally { $zip.Dispose() }
    New-Item -ItemType Directory -Path $runtimeRoot -Force | Out-Null
    Expand-Archive -LiteralPath $archive -DestinationPath $runtimeRoot -Force
    @{ version=$release.tag_name; source=$asset.browser_download_url; sha256=$expected } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $runtimeRoot 'source.json') -Encoding utf8
}
$env:OLLAMA_HOST = '127.0.0.1:11434'
$env:OLLAMA_MODELS = $modelRoot
$env:OLLAMA_NO_CLOUD = '1'
$running = $false
try { $null = Invoke-RestMethod -Uri 'http://127.0.0.1:11434/api/version' -TimeoutSec 2; $running=$true } catch {}
if (-not $running) {
    Start-Process -FilePath $executable -ArgumentList 'serve' -WorkingDirectory $runtimeRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $modelRoot 'server.stdout.log') -RedirectStandardError (Join-Path $modelRoot 'server.stderr.log') | Out-Null
    for ($attempt=0; $attempt -lt 30; $attempt++) {
        try { $null = Invoke-RestMethod -Uri 'http://127.0.0.1:11434/api/version' -TimeoutSec 2; $running=$true; break } catch { Start-Sleep -Milliseconds 500 }
    }
    if (-not $running) { throw 'Lokaler Ollama-Dienst konnte nicht gestartet werden.' }
}
if ($Install) {
    Write-Output "Lade/pruefe lokales Bildmodell $Model. qwen2.5vl:3b benötigt etwa 3,2 GB."
    & $executable pull $Model
    if ($LASTEXITCODE -ne 0) { throw 'Bildmodell konnte nicht geladen werden.' }
}
Write-Output 'Ollama läuft lokal auf http://127.0.0.1:11434. Kamera-Profile werden nicht verändert.'
