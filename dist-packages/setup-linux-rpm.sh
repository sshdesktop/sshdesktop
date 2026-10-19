#!/usr/bin/env bash
# CloudDesk Fedora / RHEL / Rocky .rpm Package Installer
set -e
echo "📦 Installing CloudDesk .rpm package on RHEL / Rocky / Fedora..."
if [ -f "./clouddesk-2.4.0-1.x86_64.rpm" ]; then
  sudo rpm -Uvh ./clouddesk-2.4.0-1.x86_64.rpm || sudo dnf install ./clouddesk-2.4.0-1.x86_64.rpm -y
else
  sudo dnf install -y nodejs npm
  sudo bash ./clouddesk-installer.sh
fi
