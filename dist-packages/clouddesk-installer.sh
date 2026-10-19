#!/usr/bin/env bash
# CloudDesk 2.4.0 - All-in-One Linux Installer (Port 2222)
set -e
echo "🚀 Installing CloudDesk v2.4.0 on Linux..."
PORT="${PORT:-2222}"
mkdir -p /opt/clouddesk
cp -r ./dist /opt/clouddesk/ 2>/dev/null || true
cp ./server.js /opt/clouddesk/ 2>/dev/null || true
cp ./package.json /opt/clouddesk/ 2>/dev/null || true

# Systemd service
cat << EOF > /etc/systemd/system/clouddesk.service
[Unit]
Description=CloudDesk Web Desktop Server (Port ${PORT})
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/clouddesk
Environment=PORT=${PORT}
Environment=HOST=0.0.0.0
ExecStart=$(which node) /opt/clouddesk/server.js
Restart=always

[Install]
WantedBy=multi-user.target
EOF

if command -v systemctl >/dev/null 2>&1; then
  systemctl daemon-reload
  systemctl enable clouddesk.service
  systemctl restart clouddesk.service
fi

if command -v ufw >/dev/null 2>&1; then
  ufw allow ${PORT}/tcp comment 'CloudDesk' >/dev/null 2>&1 || true
fi

echo "🎉 CloudDesk is running on port ${PORT}! Access at: http://<SERVER_IP>:${PORT}"
echo "🔑 Login: admin / clouddesk"
