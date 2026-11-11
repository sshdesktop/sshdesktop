#!/usr/bin/env bash
# ==============================================================================
# SSH Desktop - Linux CLI Server Installation & Systemd Daemon Setup
# ==============================================================================
# Usage:
#   curl -fsSL https://get.sshdesktop.com/install.sh | sudo bash
#   or: sudo ./install-server.sh [--port 8080] [--dir /opt/sshdesktop]
# ==============================================================================

set -e

PORT="${PORT:-8080}"
if ! [[ "${PORT}" =~ ^[0-9]{1,5}$ ]] || [ "${PORT}" -lt 1 ] || [ "${PORT}" -gt 65535 ]; then
  echo "Error: PORT must be an integer between 1 and 65535."
  exit 1
fi
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALL_DIR="/opt/sshdesktop"
CONFIG_DIR="/var/lib/sshdesktop"
AUTH_FILE="${CONFIG_DIR}/auth.json"
SERVICE_NAME="sshdesktop"
SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"

echo "================================================================="
echo "        SSH Desktop - CLI Server Service Installer               "
echo "================================================================="

# Check Root Privileges
if [ "$EUID" -ne 0 ]; then
  echo "Error: This installer must be run as root (or with sudo)."
  exit 1
fi

if ! command -v systemctl >/dev/null 2>&1; then
  echo "Error: systemd/systemctl is required to install the service."
  exit 1
fi

echo "[1/5] Preparing state configuration directory..."
echo "  -> Authentication will be initialized with scrypt on first start under ${CONFIG_DIR}."

echo "[3/5] Setting up application binary in ${INSTALL_DIR}..."
mkdir -p "${INSTALL_DIR}"
chmod 755 "${INSTALL_DIR}"
if [ -f "${SCRIPT_DIR}/sshdesktop" ]; then
  install -m 0755 "${SCRIPT_DIR}/sshdesktop" "${INSTALL_DIR}/sshdesktop"
elif [ -x "/usr/local/bin/sshdesktop" ]; then
  install -m 0755 "/usr/local/bin/sshdesktop" "${INSTALL_DIR}/sshdesktop"
else
  echo "Error: sshdesktop server binary was not found beside this installer or at /usr/local/bin/sshdesktop."
  exit 1
fi

echo "[4/5] Creating Systemd Service at ${SERVICE_FILE}..."
cat <<EOF > "${SERVICE_FILE}"
[Unit]
Description=SSH Desktop - Remote Linux Administration Web Gateway
StartLimitIntervalSec=60
StartLimitBurst=5
After=network.target network-online.target sshd.service
Wants=network-online.target

[Service]
Type=simple
DynamicUser=yes
StateDirectory=sshdesktop
StateDirectoryMode=0700
WorkingDirectory=/var/lib/sshdesktop
Environment=SSHDESKTOP_DATA_DIR=/var/lib/sshdesktop
ExecStart=${INSTALL_DIR}/sshdesktop --port ${PORT} --data-dir /var/lib/sshdesktop
Restart=on-failure
RestartSec=5
LimitNOFILE=65536
StandardOutput=journal
StandardError=journal
SyslogIdentifier=sshdesktop

# Security Sandboxing & Hardening
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF

chmod 644 "${SERVICE_FILE}"

echo "[5/5] Reloading systemd and enabling service..."
systemctl daemon-reload
systemctl enable "${SERVICE_NAME}"

# Detect Server Primary IP
SERVER_IP=$(hostname -I 2>/dev/null | awk '{print $1}' || echo "your-server-ip")

echo "================================================================="
echo "   SSH Desktop Server Installation Completed Successfully!       "
echo "================================================================="
echo ""
echo " Web Gateway URL: http://${SERVER_IP}:${PORT}"
echo " Default Username: admin"
echo " Default Password: admin (change immediately; first login enforces rotation)"
echo " Security Storage: ${AUTH_FILE} (chmod 600)"
echo ""
echo " Mandatory Security Action on First Login:"
echo "   When logging in for the first time, you will be prompted to"
echo "   immediately change the default 'admin' username and password."
echo ""
echo " Service Management:"
echo "   systemctl start ${SERVICE_NAME}"
echo "   systemctl stop ${SERVICE_NAME}"
echo "   systemctl status ${SERVICE_NAME}"
echo "   journalctl -u ${SERVICE_NAME} -f"
echo "================================================================="
