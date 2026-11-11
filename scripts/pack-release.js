import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const DIST_PACKAGES = path.join(ROOT_DIR, 'dist-packages');
const PKG_VERSION = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'package.json'), 'utf8')).version || '2.4.2';

fs.mkdirSync(DIST_PACKAGES, { recursive: true });

console.log(`📦 Generating SSH Desktop ${PKG_VERSION} Release Distribution Files in dist-packages/ ...`);

// 1. Generate sshdesktop-installer.sh
const linuxInstallerSh = `#!/usr/bin/env bash
# SSH Desktop ${PKG_VERSION} - All-in-One Linux Installer (Port 2222)
set -e
echo "🚀 Installing SSH Desktop v${PKG_VERSION} on Linux..."
PORT="\${PORT:-2222}"
mkdir -p /opt/sshdesktop
cp -r ./dist /opt/sshdesktop/ 2>/dev/null || true
cp ./server.js /opt/sshdesktop/
cp ./package.json /opt/sshdesktop/
if [ -f ./package-lock.json ]; then cp ./package-lock.json /opt/sshdesktop/; fi
if [ -f ./embedded-dist.js ]; then cp ./embedded-dist.js /opt/sshdesktop/; else echo 'export const EMBEDDED_FILES = {};' > /opt/sshdesktop/embedded-dist.js; fi
if ! command -v npm >/dev/null 2>&1; then
  echo "Error: npm is required to install production dependencies."
  exit 1
fi
if [ -f /opt/sshdesktop/package-lock.json ]; then
  (cd /opt/sshdesktop && npm ci --omit=dev --no-audit --no-fund)
else
  (cd /opt/sshdesktop && npm install --omit=dev --no-audit --no-fund)
fi

# Systemd service
cat << EOF > /etc/systemd/system/sshdesktop.service
[Unit]
Description=SSH Desktop Web Desktop Server (Port \${PORT})
After=network.target

[Service]
Type=simple
DynamicUser=yes
StateDirectory=sshdesktop
StateDirectoryMode=0700
WorkingDirectory=/var/lib/sshdesktop
Environment=BACKEND_HOST=127.0.0.1
Environment=SSHDESKTOP_DATA_DIR=/var/lib/sshdesktop
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
Environment=PORT=\${PORT}
Environment=HOST=0.0.0.0
ExecStart=$(which node) /opt/sshdesktop/server.js --data-dir /var/lib/sshdesktop
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
echo "🔑 Initial Username: admin"
echo "🔑 Initial Password: sudo cat /var/lib/sshdesktop/initial-admin-credentials.txt"
`;
fs.writeFileSync(path.join(DIST_PACKAGES, 'sshdesktop-installer.sh'), linuxInstallerSh, 'utf8');

// 2. Generate setup-linux-deb.sh
const setupDebSh = `#!/usr/bin/env bash
# SSH Desktop Debian / Ubuntu .deb Package Installer
set -e
echo "📦 Installing SSH Desktop .deb package on Debian / Ubuntu..."
if [ -f "./ssh-desktop_${PKG_VERSION}_amd64.deb" ]; then
  sudo dpkg -i "./ssh-desktop_${PKG_VERSION}_amd64.deb" || sudo apt-get install -f -y
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
if [ -f "./ssh-desktop-${PKG_VERSION}-1.x86_64.rpm" ]; then
  sudo rpm -Uvh "./ssh-desktop-${PKG_VERSION}-1.x86_64.rpm" || sudo dnf install "./ssh-desktop-${PKG_VERSION}-1.x86_64.rpm" -y
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
  version: PKG_VERSION,
  releaseDate: new Date().toISOString(),
  defaultPort: 2222,
  webAuthGate: {
    enabled: true,
    defaultUsername: "admin",
    initialCredentialsFile: "/var/lib/sshdesktop/initial-admin-credentials.txt"
  },
  packages: {
    debian: {
      file: `ssh-desktop_${PKG_VERSION}_amd64.deb`,
      type: "Debian / Ubuntu DEB Package",
      command: `sudo dpkg -i ssh-desktop_${PKG_VERSION}_amd64.deb || sudo apt-get install -f -y`
    },
    redhat: {
      file: `ssh-desktop-${PKG_VERSION}-1.x86_64.rpm`,
      type: "Fedora / RHEL / Rocky Linux RPM Package",
      command: `sudo rpm -Uvh ssh-desktop-${PKG_VERSION}-1.x86_64.rpm || sudo dnf install ./ssh-desktop-${PKG_VERSION}-1.x86_64.rpm`
    },
    portable: {
      file: `ssh-desktop-${PKG_VERSION}-linux-x86_64.tar.gz`,
      type: "Portable Standalone Archive",
      command: `tar -xzvf ssh-desktop-${PKG_VERSION}-linux-x86_64.tar.gz && sudo bash sshdesktop/install.sh`
    },
    macos: {
      file: `SSHDesktop-${PKG_VERSION}.dmg`,
      type: "macOS Universal Disk Image",
      command: `hdiutil attach SSHDesktop-${PKG_VERSION}.dmg && cp -R /Volumes/SSHDesktop/SSHDesktop.app /Applications/`
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
