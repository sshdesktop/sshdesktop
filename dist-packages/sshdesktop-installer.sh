#!/usr/bin/env bash
# SSH Desktop 2.4.2 - All-in-One Linux Installer (Port 2222)
set -euo pipefail
if [ "${EUID}" -ne 0 ]; then
  echo "Error: run this installer as root (or with sudo)." >&2
  exit 1
fi
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if ! command -v systemctl >/dev/null 2>&1; then
  echo "Error: systemd/systemctl is required." >&2
  exit 1
fi
if ! command -v node >/dev/null 2>&1; then
  echo "Error: Node.js is required but was not found in PATH." >&2
  exit 1
fi
echo "🚀 Installing SSH Desktop v2.4.2 on Linux..."
PORT="${PORT:-2222}"
if ! [[ "${PORT}" =~ ^[0-9]{1,5}$ ]] || [ "${PORT}" -lt 1 ] || [ "${PORT}" -gt 65535 ]; then
  echo "Error: PORT must be an integer between 1 and 65535." >&2
  exit 1
fi
for required in dist server.js package.json; do
  if [ ! -e "${SCRIPT_DIR}/${required}" ]; then
    echo "Error: required release file or directory is missing: ${SCRIPT_DIR}/${required}" >&2
    exit 1
  fi
done
install -d -m 0755 /opt/sshdesktop
cp -a "${SCRIPT_DIR}/dist" /opt/sshdesktop/
install -m 0644 "${SCRIPT_DIR}/server.js" /opt/sshdesktop/server.js
install -m 0644 "${SCRIPT_DIR}/package.json" /opt/sshdesktop/package.json

# Systemd service
cat << EOF > /etc/systemd/system/sshdesktop.service
[Unit]
Description=SSH Desktop Web Desktop Server (Port ${PORT})
StartLimitIntervalSec=60
StartLimitBurst=5
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/sshdesktop
Environment=PORT=${PORT}
Environment=HOST=0.0.0.0
ExecStart=$(command -v node) /opt/sshdesktop/server.js
RestartSec=5
Restart=always

[Install]
WantedBy=multi-user.target
EOF

if command -v systemctl >/dev/null 2>&1; then
  systemctl daemon-reload
  systemctl enable sshdesktop.service
  systemctl restart sshdesktop.service
fi

if command -v ufw >/dev/null 2>&1; then
  ufw allow ${PORT}/tcp comment 'SSH Desktop' >/dev/null 2>&1 || true
fi

echo "🎉 SSH Desktop is running on port ${PORT}! Access at: http://<SERVER_IP>:${PORT}"
echo "🔑 Initial Username: admin"
echo "🔑 Initial Password: sudo cat /var/lib/sshdesktop/initial-admin-credentials.txt"
