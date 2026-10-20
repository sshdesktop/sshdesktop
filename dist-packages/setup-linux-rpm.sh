#!/usr/bin/env bash
# SSH Desktop Fedora / RHEL / Rocky .rpm Package Installer
set -e
echo "📦 Installing SSH Desktop .rpm package on RHEL / Rocky / Fedora..."
if [ -f "./ssh-desktop-2.4.0-1.x86_64.rpm" ]; then
  sudo rpm -Uvh ./ssh-desktop-2.4.0-1.x86_64.rpm || sudo dnf install ./ssh-desktop-2.4.0-1.x86_64.rpm -y
else
  sudo dnf install -y nodejs npm
  sudo bash ./sshdesktop-installer.sh
fi
