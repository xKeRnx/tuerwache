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

## Face worker on the same Windows PC

The **Local on Türwache** face engine runs SFace directly. You can also use **ArcFace** through the worker. Install Python and the OpenCV models as described under **Install and start**.

### Start automatically with Türwache

Under **AI providers → Face worker**, select **Automatically on this device**. Leave **Enable ArcFace for cameras** off for the first SFace check. Check the connection, turn on **Enable face worker**, and save. The built-in worker starts whenever Türwache starts, with no address or token to enter. Under **Sites → Privacy zones & AI**, you can select **Built-in face worker** as the face engine for each camera.

To use the InsightFace model for non-commercial research, click **Download ArcFace (289 MB)**. Türwache creates a `models` folder in its data directory, downloads the official archive, and verifies both the archive and the model file. Once the model status confirms installation, turn on **Enable ArcFace for cameras** and check the connection. Once both models pass, save, enrol reference photos, and select the engine per camera. The built-in worker also detects a `w600k_r50.onnx` file placed manually in the project's `ai/models` folder. [Model and license](raspberry-pi.en.md)

### Run the worker separately

For a manually started worker, select **Separate worker on the local network**. You can also run this separate instance on the same PC.

### 1. Set the token and start the worker

Open a second PowerShell window in the Türwache project folder. Put `.env` next to `package.json` in that folder. The `scripts/start-face-worker.mjs` launcher is already included.

```powershell
Set-Location 'C:\Path\to\Tuerwache'
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
if (-not (Test-Path -LiteralPath '.env')) { New-Item -ItemType File -Path '.env' | Out-Null }
notepad .env
```

Add `FACE_WORKER_TOKEN=YOUR_GENERATED_TOKEN` to `.env`, replacing the placeholder with the generated value. If the entry already exists, reuse its value. If you used the Windows installer with `-WithAI`, add `AI_PYTHON=.venv/Scripts/python.exe` if needed so the worker uses that Python environment.

```powershell
node --env-file=.env scripts/start-face-worker.mjs
```

Keep the window open once you see **Gesichts-Worker läuft auf HTTP an Port 3211.** (the worker is running on HTTP port 3211). The Türwache app continues to run on port 3210.

### 2. Connect the worker in Türwache

- As an administrator, open **AI providers → Face worker**. Enter `http://127.0.0.1:3211` for **Worker address**.
- For **Worker token**, paste the value from `.env` after the equals sign.
- Leave **Enable ArcFace for cameras** off for the first SFace check. Click **Check worker connection**. Once SFace passes, turn on **Enable face worker** and save.
- Turn on face recognition for each camera you want to use and select **Private face worker** under **Sites → Privacy zones & AI → Face engine**. Cameras with privacy zones keep face processing on Türwache.

For ArcFace, add `FACE_WORKER_ARCFACE_MODEL=C:/Path/to/w600k_r50.onnx` to `.env` with the verified model, restart the worker, and turn on **Enable ArcFace for cameras** in the panel. Check the connection and save. Enrol at least one reference photo per person under **Faces** and select **ArcFace on the local network** for the camera. See the [local network setup guide](raspberry-pi.en.md) for the model, its license and setup on another device.

## Automatic startup

For private testing, Windows Task Scheduler can run `powershell.exe -NoProfile -File C:\Path\Tuerwache\scripts\Start-Tuerwache.ps1` at user logon. Set the project working directory, disallow parallel instances and use a normal user. This task is not installed automatically. The documented Linux systemd service is preferable for an unattended server.
