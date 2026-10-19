import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const DIST_PACKAGES = path.join(ROOT_DIR, 'dist-packages');

fs.mkdirSync(DIST_PACKAGES, { recursive: true });

console.log('📦 Generating CloudDesk 2.4.0 Release Distribution Files in dist-packages/ ...');

// 1. Generate clouddesk-installer.sh
const linuxInstallerSh = `#!/usr/bin/env bash
# CloudDesk 2.4.0 - All-in-One Linux Installer (Port 2222)
set -e
echo "🚀 Installing CloudDesk v2.4.0 on Linux..."
PORT="\${PORT:-2222}"
mkdir -p /opt/clouddesk
cp -r ./dist /opt/clouddesk/ 2>/dev/null || true
cp ./server.js /opt/clouddesk/ 2>/dev/null || true
cp ./package.json /opt/clouddesk/ 2>/dev/null || true

# Systemd service
cat << EOF > /etc/systemd/system/clouddesk.service
[Unit]
Description=CloudDesk Web Desktop Server (Port \${PORT})
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/clouddesk
Environment=PORT=\${PORT}
Environment=HOST=0.0.0.0
ExecStart=$(which node) /opt/clouddesk/server.js
Restart=always

[Install]
WantedBy=multi-user.target
EOF

if command -v systemctl >/dev/null 2>&1; then
  systemctl daemon-reload
  systemctl enable clouddesk.service
  systemctl restart clouddesk.service
fi

if command -v ufw >/dev/null 2>&1; then
  ufw allow \${PORT}/tcp comment 'CloudDesk' >/dev/null 2>&1 || true
fi

echo "🎉 CloudDesk is running on port \${PORT}! Access at: http://<SERVER_IP>:\${PORT}"
echo "🔑 Login: admin / clouddesk"
`;
fs.writeFileSync(path.join(DIST_PACKAGES, 'clouddesk-installer.sh'), linuxInstallerSh, 'utf8');

// 2. Generate setup-linux-deb.sh
const setupDebSh = `#!/usr/bin/env bash
# CloudDesk Debian / Ubuntu .deb Package Installer
set -e
echo "📦 Installing CloudDesk .deb package on Debian / Ubuntu..."
if [ -f "./clouddesk_2.4.0_amd64.deb" ]; then
  sudo dpkg -i ./clouddesk_2.4.0_amd64.deb || sudo apt-get install -f -y
else
  sudo apt-get update && sudo apt-get install -y nodejs npm
  sudo bash ./clouddesk-installer.sh
fi
`;
fs.writeFileSync(path.join(DIST_PACKAGES, 'setup-linux-deb.sh'), setupDebSh, 'utf8');

// 3. Generate setup-linux-rpm.sh
const setupRpmSh = `#!/usr/bin/env bash
# CloudDesk Fedora / RHEL / Rocky .rpm Package Installer
set -e
echo "📦 Installing CloudDesk .rpm package on RHEL / Rocky / Fedora..."
if [ -f "./clouddesk-2.4.0-1.x86_64.rpm" ]; then
  sudo rpm -Uvh ./clouddesk-2.4.0-1.x86_64.rpm || sudo dnf install ./clouddesk-2.4.0-1.x86_64.rpm -y
else
  sudo dnf install -y nodejs npm
  sudo bash ./clouddesk-installer.sh
fi
`;
fs.writeFileSync(path.join(DIST_PACKAGES, 'setup-linux-rpm.sh'), setupRpmSh, 'utf8');

// 4. Generate CloudDesk-macOS-Installer.command
const macOSInstallerCmd = `#!/usr/bin/env bash
# CloudDesk macOS Launcher & Installer
echo "🍏 Launching CloudDesk macOS Edition..."
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
fs.writeFileSync(path.join(DIST_PACKAGES, 'CloudDesk-macOS-Installer.command'), macOSInstallerCmd, 'utf8');

// 5. Generate a manifest file
const manifest = {
  name: "CloudDesk",
  version: "2.4.0",
  releaseDate: new Date().toISOString(),
  defaultPort: 2222,
  webAuthGate: {
    enabled: true,
    defaultUsername: "admin",
    defaultPassword: "clouddesk"
  },
  packages: {
    debian: {
      file: "clouddesk_2.4.0_amd64.deb",
      type: "Debian / Ubuntu DEB Package",
      command: "sudo dpkg -i clouddesk_2.4.0_amd64.deb || sudo apt-get install -f -y"
    },
    redhat: {
      file: "clouddesk-2.4.0-1.x86_64.rpm",
      type: "Fedora / RHEL / Rocky Linux RPM Package",
      command: "sudo rpm -Uvh clouddesk-2.4.0-1.x86_64.rpm || sudo dnf install ./clouddesk-2.4.0-1.x86_64.rpm"
    },
    portable: {
      file: "clouddesk-2.4.0-linux-x86_64.tar.gz",
      type: "Portable Standalone Archive",
      command: "tar -xzvf clouddesk-2.4.0-linux-x86_64.tar.gz && sudo bash clouddesk/install.sh"
    },
    macos: {
      file: "CloudDesk-2.4.0.dmg",
      type: "macOS Universal Disk Image",
      command: "hdiutil attach CloudDesk-2.4.0.dmg && cp -R /Volumes/CloudDesk/CloudDesk.app /Applications/"
    }
  }
};
fs.writeFileSync(path.join(DIST_PACKAGES, 'release-manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');

console.log('✅ Generated release files in dist-packages/:');
console.log('   - clouddesk-installer.sh');
console.log('   - setup-linux-deb.sh');
console.log('   - setup-linux-rpm.sh');
console.log('   - CloudDesk-macOS-Installer.command');
console.log('   - release-manifest.json');
