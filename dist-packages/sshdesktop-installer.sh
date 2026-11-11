#!/usr/bin/env bash
# SSH Desktop 2.4.2 - All-in-One Linux Installer (Port 2222)
set -e
echo "🚀 Installing SSH Desktop v2.4.2 on Linux..."
PORT="${PORT:-2222}"
mkdir -p /opt/sshdesktop
cp -r ./dist /opt/sshdesktop/ 2>/dev/null || true
cp ./server.js /opt/sshdesktop/
cp ./package.json /opt/sshdesktop/
if [ -f ./package-lock.json ]; then cp ./package-lock.json /opt/sshdesktop/; fi
if [ -f ./embedded-dist.js ]; then cp ./embedded-dist.js /opt/sshdesktop/; else echo 'export const EMBEDDED_FILES = {};' > /opt/sshdesktop/embedded-dist.js; fi
if ! command -v npm >/dev/null 2>&1; then
  echo "Error: npm is required to install production dependencies."
  exit 1
fi
if [ -f /opt/sshdesktop/package-lock.json ]; then
  (cd /opt/sshdesktop && npm ci --omit=dev --no-audit --no-fund)
else
  (cd /opt/sshdesktop && npm install --omit=dev --no-audit --no-fund)
fi

# Systemd service
cat << EOF > /etc/systemd/system/sshdesktop.service
[Unit]
Description=SSH Desktop Web Desktop Server (Port ${PORT})
After=network.target

[Service]
Type=simple
DynamicUser=yes
StateDirectory=sshdesktop
StateDirectoryMode=0700
WorkingDirectory=/var/lib/sshdesktop
Environment=BACKEND_HOST=127.0.0.1
Environment=SSHDESKTOP_DATA_DIR=/var/lib/sshdesktop
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
Environment=PORT=${PORT}
Environment=HOST=0.0.0.0
ExecStart=$(which node) /opt/sshdesktop/server.js --data-dir /var/lib/sshdesktop
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
