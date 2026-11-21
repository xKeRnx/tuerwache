# Install on Windows

## Requirements

Windows 10/11, Node.js 24 LTS and Python 3.12 (64 bit) for local image analysis. Node 22 is also supported; Node 26 has not been approved for this release. Installers do not install arbitrary system software or open firewall ports.

- [Official Node.js downloads](https://nodejs.org/en/download)
- [Official Python downloads](https://www.python.org/downloads/windows/)

## Install and start

Clone the private repository or use the cleaned source export. Open PowerShell in a directory owned by your normal user. Do not run the server as Administrator.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\Install-Windows.ps1 -WithAI -CheckOnly
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\Install-Windows.ps1 -WithAI
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\Start-Tuerwache.ps1
```

Omit `-WithAI` if local person/face recognition is not needed. Installation uses the npm lockfile, installs FFmpeg and optional Python packages, and verifies three OpenCV model files with SHA256. It does not start the server. CheckOnly checks prerequisites without downloads or changes.

Open [Türwache](http://127.0.0.1:3210), create the first Türwache administrator, then connect Ring and enter its verification code. Enter passwords only in your own local app.

## Configuration and startup

Optionally copy `.env.example` to `.env`. The new launch scripts read this file; plain `npm start` does not. The local `.venv/Scripts/python.exe` is selected automatically unless `AI_PYTHON` is configured. Stop with Ctrl+C and let ongoing work drain. Back up and stop before upgrading. Never run two instances against one data directory.

`Start-Tuerwache.cmd` uses the same launcher. Optional local VLM installation is separate: `scripts/Start-Ollama.ps1 -Install`. Configure a vision-capable model and select it per camera. Large models can be slow without a GPU.

## Automatic startup

For private testing, Windows Task Scheduler can run `powershell.exe -NoProfile -File C:\Path\Tuerwache\scripts\Start-Tuerwache.ps1` at user logon. Set the project working directory, disallow parallel instances and use a normal user. This task is not installed automatically. The documented Linux systemd service is preferable for an unattended server.
