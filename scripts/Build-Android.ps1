param([string]$Sdk = 'H:\Android\SDK', [string]$Jdk = 'C:\Program Files\Java\jdk-17')
$ErrorActionPreference = 'Stop'
$taskProject = Split-Path -Parent $PSScriptRoot
$taskMobile = Join-Path $taskProject 'mobile'
if (!(Test-Path -LiteralPath (Join-Path $Sdk 'platforms'))) { throw 'Android SDK fehlt. -Sdk auf den vollständigen SDK-Ordner setzen.' }
if (!(Test-Path -LiteralPath (Join-Path $Jdk 'bin\java.exe'))) { throw 'JDK fehlt. -Jdk auf einen JDK-17-Ordner setzen.' }
$env:JAVA_HOME = $Jdk; $env:ANDROID_HOME = $Sdk; $env:ANDROID_SDK_ROOT = $Sdk
Push-Location -LiteralPath $taskMobile
try {
  if (!(Test-Path -LiteralPath 'node_modules')) { & npm.cmd ci; if ($LASTEXITCODE) { throw 'npm ci fehlgeschlagen.' } }
  & npx.cmd tsc --noEmit; if ($LASTEXITCODE) { throw 'TypeScript-Prüfung fehlgeschlagen.' }
  & npx.cmd expo prebuild --platform android --no-install; if ($LASTEXITCODE) { throw 'Android-Vorbereitung fehlgeschlagen.' }
  Push-Location -LiteralPath 'android'
  try { & .\gradlew.bat assembleRelease '-PreactNativeArchitectures=arm64-v8a' '-Pandroid.enableMinifyInReleaseBuilds=false' --max-workers=4 --console=plain; if ($LASTEXITCODE) { throw 'Android-Build fehlgeschlagen.' } }
  finally { Pop-Location }
  $taskArtifacts = Join-Path $taskProject 'artifacts'
  New-Item -ItemType Directory -Path $taskArtifacts -Force | Out-Null
  Copy-Item -LiteralPath 'android\app\build\outputs\apk\release\app-release.apk' -Destination (Join-Path $taskArtifacts 'Tuerwache-Android-Test.apk') -Force
  $taskPackage = Get-Content -LiteralPath 'package.json' -Raw | ConvertFrom-Json
  $taskApk = Get-Item -LiteralPath (Join-Path $taskArtifacts 'Tuerwache-Android-Test.apk')
  @{ version = $taskPackage.version; bytes = $taskApk.Length; sha256 = (Get-FileHash -LiteralPath $taskApk.FullName -Algorithm SHA256).Hash.ToLowerInvariant(); signing = 'test'; architecture = 'arm64-v8a' } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $taskArtifacts 'android-build.json') -Encoding UTF8
  Write-Output ('Test-APK: ' + (Join-Path $taskArtifacts 'Tuerwache-Android-Test.apk'))
} finally { Pop-Location }
