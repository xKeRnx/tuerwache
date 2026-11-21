#!/usr/bin/env bash
set -euo pipefail
with_ai=false
check_only=false
for argument in "$@"; do
  case "$argument" in
    --with-ai) with_ai=true ;;
    --check-only) check_only=true ;;
    *) echo "Usage: bash scripts/install-linux.sh [--with-ai] [--check-only]" >&2; exit 2 ;;
  esac
done
project_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$project_root"
command -v node >/dev/null || { echo 'Install Node.js 24 LTS from https://nodejs.org/en/download' >&2; exit 1; }
command -v npm >/dev/null
node -e 'if (![22,24].includes(Number(process.versions.node.split(".")[0]))) throw Error("Node.js 22 or 24 required")'
if $with_ai; then
  command -v python3 >/dev/null
  python3 -c 'import sys; assert (3,10) <= sys.version_info[:2] <= (3,13), "Python 3.10-3.13 required"; print(sys.version.split()[0])'
fi
printf 'Project: %s | Architecture: %s | AI: %s\n' "$project_root" "$(uname -m)" "$with_ai"
if $check_only; then echo 'Checks passed. No files changed, downloads or services started.'; exit 0; fi
if command -v ss >/dev/null && ss -H -ltn 'sport = :3210' | read -r _; then
  echo 'Stop the server on port 3210 before installing/updating.' >&2; exit 1
fi
npm ci --omit=dev
npm --prefix node_modules/ffmpeg-for-homebridge run install
node_modules/ffmpeg-for-homebridge/ffmpeg -version >/dev/null
if $with_ai; then
  if [[ ! -x .venv/bin/python ]]; then python3 -m venv .venv; fi
  .venv/bin/python -m pip install --only-binary=:all: -r ai/requirements.txt
  .venv/bin/python ai/install-models.py
  .venv/bin/python -c 'import cv2, numpy; print("OpenCV", cv2.__version__)'
fi
echo 'Installed. Start: bash scripts/start-linux.sh; open http://127.0.0.1:3210. External access remains off.'
