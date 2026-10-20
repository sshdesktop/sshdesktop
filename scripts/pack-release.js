import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const DIST_PACKAGES = path.join(ROOT_DIR, 'dist-packages');

fs.mkdirSync(DIST_PACKAGES, { recursive: true });

console.log('📦 Generating SSH Desktop 2.4.0 Release Distribution Files in dist-packages/ ...');

// 1. Generate sshdesktop-installer.sh
const linuxInstallerSh = `#!/usr/bin/env bash
# SSH Desktop 2.4.0 - All-in-One Linux Installer (Port 2222)
set -e
echo "🚀 Installing SSH Desktop v2.4.0 on Linux..."
PORT="\${PORT:-2222}"
mkdir -p /opt/sshdesktop
cp -r ./dist /opt/sshdesktop/ 2>/dev/null || true
cp ./server.js /opt/sshdesktop/ 2>/dev/null || true
cp ./package.json /opt/sshdesktop/ 2>/dev/null || true

# Systemd service
cat << EOF > /etc/systemd/system/sshdesktop.service
[Unit]
Description=SSH Desktop Web Desktop Server (Port \${PORT})
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/sshdesktop
Environment=PORT=\${PORT}
Environment=HOST=0.0.0.0
ExecStart=$(which node) /opt/sshdesktop/server.js
Restart=always

[Install]
WantedBy=multi-user.target
EOF

if command -v systemctl >/dev/null 2>&1; then
  systemctl daemon-reload
  systemctl enable sshdesktop.service
  systemctl restart sshdesktop.service
fi

if command -v ufw >/dev/null 2>&1; then
  ufw allow \${PORT}/tcp comment 'SSH Desktop' >/dev/null 2>&1 || true
fi

echo "🎉 SSH Desktop is running on port \${PORT}! Access at: http://<SERVER_IP>:\${PORT}"
echo "🔑 Login: admin / sshdesktop"
`;
fs.writeFileSync(path.join(DIST_PACKAGES, 'sshdesktop-installer.sh'), linuxInstallerSh, 'utf8');

// 2. Generate setup-linux-deb.sh
const setupDebSh = `#!/usr/bin/env bash
# SSH Desktop Debian / Ubuntu .deb Package Installer
set -e
echo "📦 Installing SSH Desktop .deb package on Debian / Ubuntu..."
if [ -f "./ssh-desktop_2.4.0_amd64.deb" ]; then
  sudo dpkg -i ./ssh-desktop_2.4.0_amd64.deb || sudo apt-get install -f -y
else
  sudo apt-get update && sudo apt-get install -y nodejs npm
  sudo bash ./sshdesktop-installer.sh
fi
`;
fs.writeFileSync(path.join(DIST_PACKAGES, 'setup-linux-deb.sh'), setupDebSh, 'utf8');

// 3. Generate setup-linux-rpm.sh
const setupRpmSh = `#!/usr/bin/env bash
# SSH Desktop Fedora / RHEL / Rocky .rpm Package Installer
set -e
echo "📦 Installing SSH Desktop .rpm package on RHEL / Rocky / Fedora..."
if [ -f "./ssh-desktop-2.4.0-1.x86_64.rpm" ]; then
  sudo rpm -Uvh ./ssh-desktop-2.4.0-1.x86_64.rpm || sudo dnf install ./ssh-desktop-2.4.0-1.x86_64.rpm -y
else
  sudo dnf install -y nodejs npm
  sudo bash ./sshdesktop-installer.sh
fi
`;
fs.writeFileSync(path.join(DIST_PACKAGES, 'setup-linux-rpm.sh'), setupRpmSh, 'utf8');

// 4. Generate SSHDesktop-macOS-Installer.command
const macOSInstallerCmd = `#!/usr/bin/env bash
# SSH Desktop macOS Launcher & Installer
echo "🍏 Launching SSH Desktop macOS Edition..."
DIR="$(cd "$(dirname "\${BASH_SOURCE[0]}")" && pwd)"
PORT=2222
export PORT
if command -v node >/dev/null 2>&1; then
  node "\$DIR/server.js" &
  SERVER_PID=\$!
  sleep 1
  open "http://localhost:\${PORT}"
  wait \$SERVER_PID
else
  open "\$DIR/dist/index.html"
fi
`;
fs.writeFileSync(path.join(DIST_PACKAGES, 'SSHDesktop-macOS-Installer.command'), macOSInstallerCmd, 'utf8');

// 5. Generate a manifest file
const manifest = {
  name: "SSH Desktop",
  version: "2.4.0",
  releaseDate: new Date().toISOString(),
  defaultPort: 2222,
  webAuthGate: {
    enabled: true,
    defaultUsername: "admin",
    defaultPassword: "sshdesktop"
  },
  packages: {
    debian: {
      file: "ssh-desktop_2.4.0_amd64.deb",
      type: "Debian / Ubuntu DEB Package",
      command: "sudo dpkg -i ssh-desktop_2.4.0_amd64.deb || sudo apt-get install -f -y"
    },
    redhat: {
      file: "ssh-desktop-2.4.0-1.x86_64.rpm",
      type: "Fedora / RHEL / Rocky Linux RPM Package",
      command: "sudo rpm -Uvh ssh-desktop-2.4.0-1.x86_64.rpm || sudo dnf install ./ssh-desktop-2.4.0-1.x86_64.rpm"
    },
    portable: {
      file: "ssh-desktop-2.4.0-linux-x86_64.tar.gz",
      type: "Portable Standalone Archive",
      command: "tar -xzvf ssh-desktop-2.4.0-linux-x86_64.tar.gz && sudo bash sshdesktop/install.sh"
    },
    macos: {
      file: "SSHDesktop-2.4.0.dmg",
      type: "macOS Universal Disk Image",
      command: "hdiutil attach SSHDesktop-2.4.0.dmg && cp -R /Volumes/SSHDesktop/SSHDesktop.app /Applications/"
    }
  }
};
fs.writeFileSync(path.join(DIST_PACKAGES, 'release-manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');

console.log('✅ Generated release files in dist-packages/:');
console.log('   - sshdesktop-installer.sh');
console.log('   - setup-linux-deb.sh');
console.log('   - setup-linux-rpm.sh');
console.log('   - SSHDesktop-macOS-Installer.command');
console.log('   - release-manifest.json');
