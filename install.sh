#!/usr/bin/env bash
# ==============================================================================
# SSH Desktop - Single Binary & Systemd Service Installer
# Frontend Port: 2222 | Backend Port: 2020
# ==============================================================================

set -e

if [ "$EUID" -ne 0 ]; then
  echo "Error: Please run this installer as root (or with sudo)."
  exit 1
fi

echo "================================================================"
echo "📦 Installing SSH Desktop Single Binary & Systemd Service..."
echo "================================================================"

INSTALL_BIN="/usr/local/bin/sshdesktop"
SERVICE_DEST="/etc/systemd/system/sshdesktop.service"
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Detect binary or source
if [ -f "$DIR/sshdesktop" ]; then
  cp "$DIR/sshdesktop" "$INSTALL_BIN"
elif [ -f "$DIR/bin/sshdesktop-linux-x64" ]; then
  cp "$DIR/bin/sshdesktop-linux-x64" "$INSTALL_BIN"
elif [ -f "$DIR/server.js" ] && command -v node >/dev/null 2>&1; then
  mkdir -p /opt/sshdesktop
  cp -r "$DIR/." /opt/sshdesktop/
  cat << 'EOF' > "$INSTALL_BIN"
#!/usr/bin/env bash
exec node /opt/sshdesktop/server.js "$@"
EOF
else
  echo "[ERROR] Standalone binary 'sshdesktop' not found in $DIR."
  echo "Please place the single binary file 'sshdesktop' in this directory."
  exit 1
fi

chmod +x "$INSTALL_BIN"

# Install Systemd Service File
cat << 'EOF' > "$SERVICE_DEST"
[Unit]
Description=SSH Desktop All-in-One Engine (Frontend: 2222, Backend: 2020)
After=network.target network-online.target sshd.service
Wants=network-online.target

[Service]
Type=simple
User=root
WorkingDirectory=/root
Environment=FRONTEND_PORT=2222
Environment=BACKEND_PORT=2020
Environment=HOST=0.0.0.0
ExecStart=/usr/local/bin/sshdesktop
Restart=always
RestartSec=3
LimitNOFILE=65536
StandardOutput=journal
StandardError=journal
SyslogIdentifier=sshdesktop

[Install]
WantedBy=multi-user.target
EOF

chmod 644 "$SERVICE_DEST"
systemctl daemon-reload
systemctl enable --now sshdesktop

PRIMARY_IP=$(hostname -I 2>/dev/null | awk '{print $1}' || echo "localhost")

echo "================================================================"
echo "🎉 SSH Desktop Installed & Started Successfully!"
echo "📡 Web Desktop URL:  http://${PRIMARY_IP}:2222"
echo "⚡ Backend API:      http://${PRIMARY_IP}:2020"
echo "🔑 Default Login:    admin / sshdesktop"
echo "⚙️ Systemd Service:  sshdesktop"
echo "📋 Check Status:     systemctl status sshdesktop"
echo "📋 View Logs:        journalctl -u sshdesktop -f"
echo "================================================================"
