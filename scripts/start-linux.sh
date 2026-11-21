#!/usr/bin/env bash
set -euo pipefail
project_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$project_root"
file_configures_python=false
if [[ -f .env ]] && node -e 'const fs=require("node:fs");process.exit(/^\s*AI_PYTHON\s*=/m.test(fs.readFileSync(".env","utf8"))?0:1)'; then file_configures_python=true; fi
if [[ -z "${AI_PYTHON:-}" && "$file_configures_python" == false && -x .venv/bin/python ]]; then export AI_PYTHON="$project_root/.venv/bin/python"; fi
arguments=()
if [[ -f .env ]]; then arguments+=(--env-file=.env); fi
exec node "${arguments[@]}" src/server.mjs
