#!/usr/bin/env bash
# SSH Desktop Debian / Ubuntu .deb Package Installer
set -e
echo "📦 Installing SSH Desktop .deb package on Debian / Ubuntu..."
if [ -f "./ssh-desktop_2.4.0_amd64.deb" ]; then
  sudo dpkg -i ./ssh-desktop_2.4.0_amd64.deb || sudo apt-get install -f -y
else
  sudo apt-get update && sudo apt-get install -y nodejs npm
  sudo bash ./sshdesktop-installer.sh
fi
