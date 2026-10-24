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
INSTALL_DIR="/opt/sshdesktop"
CONFIG_DIR="/etc/sshdesktop"
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

echo "[1/5] Setting up secure configuration directory..."
mkdir -p "${CONFIG_DIR}"
chmod 700 "${CONFIG_DIR}"

# Initialize /etc/sshdesktop/auth.json if not present
if [ ! -f "${AUTH_FILE}" ]; then
  echo "[2/5] Initializing default security credentials in ${AUTH_FILE}..."
  SALT=$(cat /proc/sys/kernel/random/uuid 2>/dev/null || date +%s%N)
  
  # Generate salted SHA-256 for default 'admin' password
  if command -v openssl >/dev/null 2>&1; then
    PASS_HASH=$(printf "%s::sshdesktop_secure_auth_v2::admin" "${SALT}" | openssl dgst -sha256 | awk '{print $NF}')
  elif command -v sha256sum >/dev/null 2>&1; then
    PASS_HASH=$(printf "%s::sshdesktop_secure_auth_v2::admin" "${SALT}" | sha256sum | awk '{print $1}')
  else
    PASS_HASH="8c6976e5b5410415bde908bd4dee15dfb167a9c873fc4bb8a81f6f2ab448a918"
  fi

  cat <<EOF > "${AUTH_FILE}"
{
  "username": "admin",
  "password_hash": "${PASS_HASH}",
  "salt": "${SALT}",
  "must_change_password": true,
  "created_at": $(date +%s),
  "last_login_at": null
}
EOF

  chmod 600 "${AUTH_FILE}"
  echo "  -> Created ${AUTH_FILE} with strict permissions (chmod 600)."
else
  echo "[2/5] Existing credentials detected at ${AUTH_FILE}. Preserving configuration."
  chmod 600 "${AUTH_FILE}"
fi

echo "[3/5] Setting up application binary in ${INSTALL_DIR}..."
mkdir -p "${INSTALL_DIR}"
chmod 755 "${INSTALL_DIR}"

echo "[4/5] Creating Systemd Service at ${SERVICE_FILE}..."
cat <<EOF > "${SERVICE_FILE}"
[Unit]
Description=SSH Desktop - Remote Linux Administration Web Gateway
After=network.target network-online.target sshd.service
Wants=network-online.target

[Service]
Type=simple
User=root
WorkingDirectory=${INSTALL_DIR}
ExecStart=${INSTALL_DIR}/sshdesktop --server --port ${PORT}
Restart=always
RestartSec=5
LimitNOFILE=65536
StandardOutput=journal
StandardError=journal
SyslogIdentifier=sshdesktop

# Security Sandboxing & Hardening
ProtectHome=read-only
ReadWritePaths=/etc/sshdesktop /var/log
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF

chmod 644 "${SERVICE_FILE}"

echo "[5/5] Reloading systemd and enabling service..."
systemctl daemon-reload
systemctl enable "${SERVICE_NAME}" 2>/dev/null || true

# Detect Server Primary IP
SERVER_IP=$(hostname -I 2>/dev/null | awk '{print $1}' || echo "your-server-ip")

echo "================================================================="
echo "   SSH Desktop Server Installation Completed Successfully!       "
echo "================================================================="
echo ""
echo " Web Gateway URL: http://${SERVER_IP}:${PORT}"
echo " Default Username: admin"
echo " Default Password: admin"
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
