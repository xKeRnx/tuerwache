@echo off
cd /d "%~dp0"
if exist "%~dp0.runtime\ollama\ollama.exe" powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\Start-Ollama.ps1"
echo Tuerwache startet unter http://127.0.0.1:3210
echo Dieses Fenster offen lassen. Beenden mit Strg+C.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\Start-Tuerwache.ps1"
pause
