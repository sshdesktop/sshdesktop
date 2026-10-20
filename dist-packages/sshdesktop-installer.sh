#!/usr/bin/env bash
# SSH Desktop 2.4.0 - All-in-One Linux Installer (Port 2222)
set -e
echo "🚀 Installing SSH Desktop v2.4.0 on Linux..."
PORT="${PORT:-2222}"
mkdir -p /opt/sshdesktop
cp -r ./dist /opt/sshdesktop/ 2>/dev/null || true
cp ./server.js /opt/sshdesktop/ 2>/dev/null || true
cp ./package.json /opt/sshdesktop/ 2>/dev/null || true

# Systemd service
cat << EOF > /etc/systemd/system/sshdesktop.service
[Unit]
Description=SSH Desktop Web Desktop Server (Port ${PORT})
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/sshdesktop
Environment=PORT=${PORT}
Environment=HOST=0.0.0.0
ExecStart=$(which node) /opt/sshdesktop/server.js
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
echo "🔑 Login: admin / sshdesktop"
