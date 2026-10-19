#!/usr/bin/env bash
# CloudDesk Debian / Ubuntu .deb Package Installer
set -e
echo "📦 Installing CloudDesk .deb package on Debian / Ubuntu..."
if [ -f "./clouddesk_2.4.0_amd64.deb" ]; then
  sudo dpkg -i ./clouddesk_2.4.0_amd64.deb || sudo apt-get install -f -y
else
  sudo apt-get update && sudo apt-get install -y nodejs npm
  sudo bash ./clouddesk-installer.sh
fi
