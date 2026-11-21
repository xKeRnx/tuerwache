#!/usr/bin/env bash
# Explicit opt-in. Run only after a successful manual start from /opt/tuerwache.
set -euo pipefail
if [[ "$#" != 2 || "$1" != --user || ! "$2" =~ ^[a-z_][a-z0-9_-]*\$?$ ]]; then
  echo 'Usage: sudo bash scripts/install-service.sh --user EXISTING_NON_ROOT_USER' >&2; exit 2
fi
[[ "$EUID" == 0 ]] || { echo 'Run with sudo.' >&2; exit 1; }
service_user="$2"
[[ "$(id -u "$service_user")" != 0 ]] || { echo 'Service must not run as root.' >&2; exit 1; }
project_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
# A fixed, simple service path prevents systemd specifier/quoting errors.
[[ "$project_root" == /opt/tuerwache ]] || { echo 'Install this service from /opt/tuerwache (see docs/linux.md).' >&2; exit 1; }
node_binary="$(command -v node)"
[[ "$node_binary" == /usr/bin/node || "$node_binary" == /usr/local/bin/node ]] || { echo 'Use system-wide Node.js, not a root/user NVM installation.' >&2; exit 1; }
runuser -u "$service_user" -- test -r /opt/tuerwache/src/server.mjs
runuser -u "$service_user" -- test -w /opt/tuerwache/data
install -d -o "$service_user" -m 700 /opt/tuerwache/backups
unit_path=/etc/systemd/system/tuerwache.service
[[ ! -e "$unit_path" ]] || { echo 'Existing service preserved. Review/update it manually.' >&2; exit 1; }
cat > "$unit_path" <<EOF
[Unit]
Description=Tuerwache private camera server
After=network-online.target
Wants=network-online.target
[Service]
Type=simple
User=$service_user
WorkingDirectory=/opt/tuerwache
Environment=NODE_ENV=production
Environment=PATH=/usr/local/bin:/usr/bin:/bin
ExecStart=/bin/bash /opt/tuerwache/scripts/start-linux.sh
Restart=on-failure
RestartSec=10
TimeoutStopSec=260
KillMode=mixed
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/opt/tuerwache/data /opt/tuerwache/backups
UMask=0077
[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable --now tuerwache.service
echo 'Service installed. Status: systemctl status tuerwache; logs: journalctl -u tuerwache -f'
