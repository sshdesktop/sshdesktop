#!/usr/bin/env bash
# ==============================================================================
# SSH Desktop - Linux CLI Web Desktop Installer & Service Runner
# Port: 2222 (or custom with --port 222)
# Features: Web Desktop, Username & Password Authentication Gate
# ==============================================================================

set -e

PORT=2222
INSTALL_DIR="/opt/sshdesktop"

# Parse arguments
while [[ "$#" -gt 0 ]]; do
  case $1 in
    --port|-p) PORT="$2"; shift ;;
    --dir|-d) INSTALL_DIR="$2"; shift ;;
    *) echo "Unknown parameter: $1"; exit 1 ;;
  esac
  shift
done

BOLD='\033[1m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
NC='\033[0m'

echo -e "${CYAN}"
cat << "EOF"
   ____ _                 _ ____            _    
  / ___| | ___  _   _  __| |  _ \  ___  ___| | __
 | |   | |/ _ \| | | |/ _` | | | |/ _ \/ __| |/ /
 | |___| | (_) | |_| | (_| | |_| |  __/\__ \   < 
  \____|_|\___/ \__,_|\__,_|____/ \___||___/_|\_\
  Linux CLI Web Desktop Runner (Port 2222)
EOF
echo -e "${NC}"

if [ "$EUID" -ne 0 ]; then
  echo -e "${RED}[ERROR] Please run this installer as root or with sudo:${NC}"
  echo -e "${YELLOW}  sudo bash $0 --port ${PORT}${NC}"
  exit 1
fi

echo -e "${BLUE}[1/5] 📦 Checking & Installing Node.js LTS Runtime...${NC}"

if ! command -v node >/dev/null 2>&1; then
  echo "      Installing Node.js..."
  if command -v apt-get >/dev/null 2>&1; then
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt-get install -y nodejs
  elif command -v dnf >/dev/null 2>&1; then
    dnf install -y nodejs npm
  elif command -v apk >/dev/null 2>&1; then
    apk add nodejs npm
  elif command -v pacman >/dev/null 2>&1; then
    pacman -Sy --noconfirm nodejs npm
  fi
fi

NODE_VER=$(node -v)
echo -e "${GREEN}      ✅ Node.js detected: ${NODE_VER}${NC}"

echo -e "${BLUE}[2/5] 📂 Preparing SSH Desktop Application in ${INSTALL_DIR}...${NC}"

mkdir -p "$INSTALL_DIR"
CURRENT_DIR=$(pwd)

# Copy files if running from repo directory
if [ -f "$CURRENT_DIR/server.js" ] && [ -d "$CURRENT_DIR/dist" ]; then
  cp -r "$CURRENT_DIR/dist" "$INSTALL_DIR/"
  cp "$CURRENT_DIR/server.js" "$INSTALL_DIR/"
  cp "$CURRENT_DIR/package.json" "$INSTALL_DIR/"
  if [ -f "$CURRENT_DIR/package-lock.json" ]; then
    cp "$CURRENT_DIR/package-lock.json" "$INSTALL_DIR/"
  fi
  if [ -f "$CURRENT_DIR/embedded-dist.js" ]; then
    cp "$CURRENT_DIR/embedded-dist.js" "$INSTALL_DIR/"
  else
    echo 'export const EMBEDDED_FILES = {};' > "$INSTALL_DIR/embedded-dist.js"
  fi
else
  # Running from standalone 1-liner: ensure dist and server.js exist
  if [ -d "./dist" ]; then
    cp -r ./dist "$INSTALL_DIR/"
  fi
  if [ -f "./server.js" ]; then
    cp ./server.js "$INSTALL_DIR/"
  fi
  if [ -f "./package.json" ]; then
    cp ./package.json "$INSTALL_DIR/"
  fi
  if [ -f "./package-lock.json" ]; then
    cp ./package-lock.json "$INSTALL_DIR/"
  fi
  if [ -f "./embedded-dist.js" ]; then
    cp ./embedded-dist.js "$INSTALL_DIR/"
  elif [ ! -f "$INSTALL_DIR/embedded-dist.js" ]; then
    echo 'export const EMBEDDED_FILES = {};' > "$INSTALL_DIR/embedded-dist.js"
  fi
fi

if [ -f "$INSTALL_DIR/package.json" ]; then
  if ! command -v npm >/dev/null 2>&1; then
    echo -e "${RED}[ERROR] npm is required to install production backend dependencies.${NC}"
    exit 1
  fi
  if [ -f "$INSTALL_DIR/package-lock.json" ]; then
    (cd "$INSTALL_DIR" && npm ci --omit=dev --no-audit --no-fund)
  else
    (cd "$INSTALL_DIR" && npm install --omit=dev --no-audit --no-fund)
  fi
fi

echo -e "${BLUE}[3/5] 🛡️ Opening Port ${PORT} in Firewall...${NC}"

if command -v ufw >/dev/null 2>&1; then
  ufw allow ${PORT}/tcp comment 'SSH Desktop Web Desktop' >/dev/null 2>&1 || true
fi

if command -v firewall-cmd >/dev/null 2>&1 && systemctl is-active --quiet firewalld 2>/dev/null; then
  firewall-cmd --permanent --add-port=${PORT}/tcp >/dev/null 2>&1 || true
  firewall-cmd --reload >/dev/null 2>&1 || true
fi

echo -e "${GREEN}      ✅ Firewall configured for Port ${PORT}/tcp.${NC}"

echo -e "${BLUE}[4/5] ⚙️ Creating Systemd 24/7 Background Service...${NC}"

cat << EOF > /etc/systemd/system/sshdesktop-web.service
[Unit]
Description=SSH Desktop Web Desktop Service
After=network.target

[Service]
Type=simple
DynamicUser=yes
StateDirectory=sshdesktop
StateDirectoryMode=0700
WorkingDirectory=/var/lib/sshdesktop
Environment=PORT=${PORT}
Environment=HOST=0.0.0.0
Environment=BACKEND_HOST=127.0.0.1
Environment=SSHDESKTOP_DATA_DIR=/var/lib/sshdesktop
ExecStart=$(which node) ${INSTALL_DIR}/server.js --data-dir /var/lib/sshdesktop
Restart=always
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable sshdesktop-web.service
systemctl restart sshdesktop-web.service

sleep 1

echo -e "${BLUE}[5/5] 🌐 Verifying Active Web Desktop on Port ${PORT}...${NC}"

PRIMARY_IP=$(ip -4 addr show scope global 2>/dev/null | awk '/inet / {print $2}' | cut -d/ -f1 | head -n 1)
if [ -z "$PRIMARY_IP" ]; then
  PRIMARY_IP="localhost"
fi

echo ""
echo -e "${GREEN}==============================================================================${NC}"
echo -e "${BOLD}${GREEN}🎉 SSH Desktop Web Desktop is Live & Accessible!${NC}"
echo -e "${GREEN}==============================================================================${NC}"
echo ""
echo -e "  ${BOLD}🌐 Open Website URL in your Browser:${NC}"
echo -e "     ${CYAN}http://${PRIMARY_IP}:${PORT}${NC}"
echo ""
echo -e "  ${BOLD}🔒 Authentication Gate Credentials:${NC}"
echo -e "     Username:  ${YELLOW}admin${NC}"
echo -e "     Password:  ${YELLOW}sudo cat /var/lib/sshdesktop/initial-admin-credentials.txt${NC}"
echo ""
echo -e "  ${BOLD}Service Management Commands:${NC}"
echo -e "     Check Status: ${BOLD}systemctl status sshdesktop-web${NC}"
echo -e "     Restart:      ${BOLD}systemctl restart sshdesktop-web${NC}"
echo -e "     View Logs:    ${BOLD}journalctl -u sshdesktop-web -f${NC}"
echo ""
echo -e "${GREEN}==============================================================================${NC}"
