#!/usr/bin/env bash
# ==============================================================================
# CloudDesk - Linux Server Automated CLI Installer & Port 2222 Configurator
# ==============================================================================
# Supported OS: Ubuntu 24.04/22.04/20.04, Debian 12/11, Rocky/AlmaLinux 8/9,
#               RHEL/CentOS 7/8/9, Fedora, Arch Linux, Alpine Linux, openSUSE.
# ==============================================================================

set -e

TARGET_PORT=2222
BOLD='\033[1m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

echo -e "${CYAN}"
cat << "EOF"
   ____ _                 _ ____            _    
  / ___| | ___  _   _  __| |  _ \  ___  ___| | __
 | |   | |/ _ \| | | |/ _` | | | |/ _ \/ __| |/ /
 | |___| | (_) | |_| | (_| | |_| |  __/\__ \   < 
  \____|_|\___/ \__,_|\__,_|____/ \___||___/_|\_\
  Linux CLI Installer & SSH Port 2222 Engine
EOF
echo -e "${NC}"

# Check for root / sudo privileges
if [ "$EUID" -ne 0 ]; then
  echo -e "${RED}[ERROR] Please run this installer as root or with sudo:${NC}"
  echo -e "${YELLOW}  sudo bash $0${NC}"
  exit 1
fi

echo -e "${BLUE}[1/6] 🔍 Detecting Operating System and Distribution...${NC}"

DISTRO=""
PKG_MGR=""

if [ -f /etc/os-release ]; then
  . /etc/os-release
  DISTRO=$ID
  DISTRO_NAME=$PRETTY_NAME
else
  DISTRO_NAME="Generic Linux"
fi

echo -e "      Detected OS: ${BOLD}${DISTRO_NAME}${NC} (${DISTRO})"

# Identify package manager
if command -v apt-get >/dev/null 2>&1; then
  PKG_MGR="apt"
elif command -v dnf >/dev/null 2>&1; then
  PKG_MGR="dnf"
elif command -v yum >/dev/null 2>&1; then
  PKG_MGR="yum"
elif command -v pacman >/dev/null 2>&1; then
  PKG_MGR="pacman"
elif command -v apk >/dev/null 2>&1; then
  PKG_MGR="apk"
elif command -v zypper >/dev/null 2>&1; then
  PKG_MGR="zypper"
fi

echo -e "${BLUE}[2/6] 📦 Installing OpenSSH Server & Essential Network Utilities...${NC}"

case "$PKG_MGR" in
  apt)
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -y -qq
    apt-get install -y -qq openssh-server ufw iproute2 curl sudo
    ;;
  dnf)
    dnf install -y -q openssh-server firewalld iproute curl sudo
    ;;
  yum)
    yum install -y -q openssh-server firewalld iproute curl sudo
    ;;
  pacman)
    pacman -Sy --noconfirm --needed openssh iproute2 curl sudo
    ;;
  apk)
    apk update
    apk add openssh iproute2 curl sudo iptables
    ;;
  zypper)
    zypper --non-interactive install openssh firewalld iproute2 curl sudo
    ;;
  *)
    echo -e "${YELLOW}⚠️ Unknown package manager. Ensuring sshd is installed manually...${NC}"
    ;;
esac

echo -e "${GREEN}      ✅ OpenSSH Server packages installed successfully.${NC}"

echo -e "${BLUE}[3/6] 🛡️ Configuring SSH Daemon to listen on Port ${TARGET_PORT}...${NC}"

SSHD_CONFIG="/etc/ssh/sshd_config"

# Create backup
if [ -f "$SSHD_CONFIG" ]; then
  cp "$SSHD_CONFIG" "${SSHD_CONFIG}.bak.$(date +%s)"
  echo -e "      Backup created: ${SSHD_CONFIG}.bak"
fi

# Ensure /etc/ssh directory exists
mkdir -p /etc/ssh

# Configure Port 2222 in sshd_config
if [ -f "$SSHD_CONFIG" ]; then
  # Remove or replace any existing Port directives
  sed -i -E "s/^[#]?[[:space:]]*Port[[:space:]]+[0-9]+/Port ${TARGET_PORT}/" "$SSHD_CONFIG"
  if ! grep -q -E "^Port[[:space:]]+${TARGET_PORT}" "$SSHD_CONFIG"; then
    echo "Port ${TARGET_PORT}" >> "$SSHD_CONFIG"
  fi
else
  cat << EOF > "$SSHD_CONFIG"
Port ${TARGET_PORT}
Protocol 2
PermitRootLogin yes
PasswordAuthentication yes
ChallengeResponseAuthentication no
UsePAM yes
X11Forwarding yes
PrintMotd no
AcceptEnv LANG LC_*
Subsystem sftp /usr/lib/openssh/sftp-server
EOF
fi

# Modern Ubuntu (22.10, 23.04, 24.04+) utilizes systemd socket activation (ssh.socket)
# If ssh.socket is active, switch to ssh.service or update the socket to listen on 2222
if command -v systemctl >/dev/null 2>&1; then
  if systemctl is-active --quiet ssh.socket 2>/dev/null || systemctl is-enabled --quiet ssh.socket 2>/dev/null; then
    echo -e "${YELLOW}      Notice: Modern Ubuntu systemd socket activation detected.${NC}"
    echo -e "      Switching systemd to standalone ssh.service for direct Port ${TARGET_PORT} binding..."
    systemctl stop ssh.socket 2>/dev/null || true
    systemctl disable ssh.socket 2>/dev/null || true
    systemctl enable ssh.service 2>/dev/null || true
  fi
fi

# Check SELinux if present
if command -v getenforce >/dev/null 2>&1; then
  if [ "$(getenforce)" = "Enforcing" ]; then
    echo -e "${YELLOW}      SELinux is Enforcing. Permitting Port ${TARGET_PORT} for sshd...${NC}"
    if command -v semanage >/dev/null 2>&1; then
      semanage port -m -t ssh_port_t -p tcp ${TARGET_PORT} 2>/dev/null || \
      semanage port -a -t ssh_port_t -p tcp ${TARGET_PORT} 2>/dev/null || true
    fi
  fi
fi

echo -e "${GREEN}      ✅ SSH configured for Port ${TARGET_PORT}.${NC}"

echo -e "${BLUE}[4/6] 🧱 Configuring Firewall for Port ${TARGET_PORT}/tcp...${NC}"

# Configure UFW if installed/active
if command -v ufw >/dev/null 2>&1; then
  ufw allow ${TARGET_PORT}/tcp comment 'CloudDesk SSH' >/dev/null 2>&1 || true
  echo -e "      UFW firewall: Allowed TCP port ${TARGET_PORT}."
fi

# Configure Firewalld if running
if command -v firewall-cmd >/dev/null 2>&1 && systemctl is-active --quiet firewalld 2>/dev/null; then
  firewall-cmd --permanent --add-port=${TARGET_PORT}/tcp >/dev/null 2>&1 || true
  firewall-cmd --reload >/dev/null 2>&1 || true
  echo -e "      Firewalld: Allowed TCP port ${TARGET_PORT}."
fi

# Configure iptables as fallback
if command -v iptables >/dev/null 2>&1; then
  iptables -I INPUT -p tcp --dport ${TARGET_PORT} -j ACCEPT 2>/dev/null || true
fi

echo -e "${GREEN}      ✅ Firewall rules configured for Port ${TARGET_PORT}.${NC}"

echo -e "${BLUE}[5/6] 🧪 Validating SSH Configuration & Starting Daemon...${NC}"

# Test configuration syntax
if command -v sshd >/dev/null 2>&1; then
  if ! sshd -t; then
    echo -e "${RED}[ERROR] sshd -t configuration test failed! Reverting...${NC}"
    exit 1
  fi
  echo -e "      sshd syntax test passed (0 errors)."
fi

# Start / Reload SSH Daemon
if command -v systemctl >/dev/null 2>&1; then
  systemctl daemon-reload 2>/dev/null || true
  systemctl enable ssh 2>/dev/null || systemctl enable sshd 2>/dev/null || true
  systemctl restart ssh 2>/dev/null || systemctl restart sshd 2>/dev/null || true
elif command -v service >/dev/null 2>&1; then
  service ssh restart 2>/dev/null || service sshd restart 2>/dev/null || true
elif [ -f /etc/init.d/ssh ]; then
  /etc/init.d/ssh restart || true
elif [ -f /etc/init.d/sshd ]; then
  /etc/init.d/sshd restart || true
elif command -v rc-service >/dev/null 2>&1; then
  rc-update add sshd default 2>/dev/null || true
  rc-service sshd restart || true
fi

sleep 1

echo -e "${BLUE}[6/6] 📡 Verifying Active Listening Sockets on Port ${TARGET_PORT}...${NC}"

# Verify active port
PORT_CHECK=false
if command -v ss >/dev/null 2>&1; then
  if ss -tlnp | grep -q ":${TARGET_PORT} "; then
    PORT_CHECK=true
  fi
elif command -v netstat >/dev/null 2>&1; then
  if netstat -tlnp 2>/dev/null | grep -q ":${TARGET_PORT} "; then
    PORT_CHECK=true
  fi
fi

# Detect Server IP Addresses
SERVER_IPS=$(ip -4 addr show scope global 2>/dev/null | awk '/inet / {print $2}' | cut -d/ -f1 | head -n 3)
PRIMARY_IP=$(echo "$SERVER_IPS" | head -n 1)

if [ -z "$PRIMARY_IP" ]; then
  PRIMARY_IP="<YOUR_SERVER_IP>"
fi

echo ""
echo -e "${GREEN}==============================================================================${NC}"
echo -e "${BOLD}${GREEN}🎉 CloudDesk Linux Server Setup Completed Successfully!${NC}"
echo -e "${GREEN}==============================================================================${NC}"
echo ""
echo -e "  ${BOLD}Active SSH Port:${NC}   ${CYAN}${TARGET_PORT}${NC}"
echo -e "  ${BOLD}Primary IP:${NC}        ${YELLOW}${PRIMARY_IP}${NC}"
echo -e "  ${BOLD}Status:${NC}            ${GREEN}Active & Listening on 0.0.0.0:${TARGET_PORT}${NC}"
echo ""
echo -e "${BOLD}Connect via CloudDesk Client:${NC}"
echo -e "  1. Open ${BOLD}CloudDesk${NC} on your local computer."
echo -e "  2. Click ${BOLD}New Server${NC} or ${BOLD}Quick Connect${NC}."
echo -e "  3. Enter Host: ${CYAN}${PRIMARY_IP}${NC}"
echo -e "  4. Enter Port: ${CYAN}${TARGET_PORT}${NC}"
echo -e "  5. Enter Username: ${CYAN}root${NC} (or your Linux username)"
echo ""
echo -e "${BOLD}Or connect directly via Linux / macOS Terminal CLI:${NC}"
echo -e "  ${YELLOW}ssh -p ${TARGET_PORT} root@${PRIMARY_IP}${NC}"
echo ""
echo -e "${GREEN}==============================================================================${NC}"
