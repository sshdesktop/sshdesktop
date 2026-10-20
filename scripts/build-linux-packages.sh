#!/usr/bin/env bash
# ==============================================================================
# SSH Desktop 2.0 - Linux Package Generator
# Generates: .deb (Ubuntu/Debian), .rpm (Fedora/RHEL/Rocky), and .tar.gz (Portable)
# ==============================================================================

set -e

APP_NAME="ssh-desktop"
APP_TITLE="SSH Desktop"
VERSION="2.4.0"
ARCH="amd64"
RPM_ARCH="x86_64"
DESCRIPTION="SSH Desktop macOS Edition for Linux Remote Server Administration"
HOMEPAGE="https://github.com/sshdesktop/sshdesktop"

OUTPUT_DIR="$(pwd)/dist-packages"
BUILD_ROOT="$(pwd)/target/linux-packages"

echo "🔨 Building Linux Packages for ${APP_TITLE} v${VERSION}..."
mkdir -p "${OUTPUT_DIR}"
mkdir -p "${BUILD_ROOT}"

# Step 1: Ensure frontend build exists
if [ ! -d "dist" ]; then
  echo "Building frontend dist..."
  npm run build
fi

# Step 2: Prepare portable TAR.GZ archive
echo "📦 Generating portable tar.gz package..."
TAR_DIR="${BUILD_ROOT}/${APP_NAME}-${VERSION}-linux-${RPM_ARCH}"
rm -rf "${TAR_DIR}"
mkdir -p "${TAR_DIR}/bin"
mkdir -p "${TAR_DIR}/share/sshdesktop"
mkdir -p "${TAR_DIR}/share/applications"
mkdir -p "${TAR_DIR}/share/icons/hicolor/128x128/apps"

# Copy dist & server assets
cp -r dist "${TAR_DIR}/share/sshdesktop/"
cp server.js "${TAR_DIR}/share/sshdesktop/"
cp package.json "${TAR_DIR}/share/sshdesktop/"

if [ -f "src-tauri/icons/128x128.png" ]; then
  cp src-tauri/icons/128x128.png "${TAR_DIR}/share/icons/hicolor/128x128/apps/sshdesktop.png"
fi

# Launcher script
cat << 'EOF' > "${TAR_DIR}/bin/sshdesktop"
#!/usr/bin/env bash
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${PORT:-2222}"
echo "🚀 Starting SSH Desktop Web Desktop on Port ${PORT}..."
if command -v node >/dev/null 2>&1; then
  PORT="${PORT}" node "${DIR}/share/sshdesktop/server.js"
else
  echo "Node.js runtime required. Please install nodejs."
  exit 1
fi
EOF
chmod +x "${TAR_DIR}/bin/sshdesktop"

# Desktop entry
cat << EOF > "${TAR_DIR}/share/applications/sshdesktop.desktop"
[Desktop Entry]
Name=${APP_TITLE}
Comment=${DESCRIPTION}
Exec=/usr/local/bin/sshdesktop
Icon=sshdesktop
Terminal=false
Type=Application
Categories=Network;System;Development;
EOF

# Install helper script inside tar
cat << 'EOF' > "${TAR_DIR}/install.sh"
#!/usr/bin/env bash
set -e
if [ "$EUID" -ne 0 ]; then
  echo "Please run as root: sudo bash install.sh"
  exit 1
fi
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
mkdir -p /opt/sshdesktop
cp -r "$DIR/share/sshdesktop/"* /opt/sshdesktop/
ln -sf /opt/sshdesktop/server.js /usr/local/bin/sshdesktop-server
cp "$DIR/bin/sshdesktop" /usr/local/bin/sshdesktop
chmod +x /usr/local/bin/sshdesktop
if [ -f "$DIR/share/applications/sshdesktop.desktop" ]; then
  cp "$DIR/share/applications/sshdesktop.desktop" /usr/share/applications/
fi
if [ -f "$DIR/share/icons/hicolor/128x128/apps/sshdesktop.png" ]; then
  mkdir -p /usr/share/icons/hicolor/128x128/apps
  cp "$DIR/share/icons/hicolor/128x128/apps/sshdesktop.png" /usr/share/icons/hicolor/128x128/apps/
fi
echo "🎉 SSH Desktop installed to /opt/sshdesktop! Run with: sshdesktop"
EOF
chmod +x "${TAR_DIR}/install.sh"

tar -czf "${OUTPUT_DIR}/${APP_NAME}-${VERSION}-linux-${RPM_ARCH}.tar.gz" -C "${BUILD_ROOT}" "${APP_NAME}-${VERSION}-linux-${RPM_ARCH}"
echo "✅ Created: ${OUTPUT_DIR}/${APP_NAME}-${VERSION}-linux-${RPM_ARCH}.tar.gz"

# Step 3: Generate Debian .DEB package structure
echo "📦 Generating Debian .deb package..."
DEB_DIR="${BUILD_ROOT}/${APP_NAME}_${VERSION}_${ARCH}"
rm -rf "${DEB_DIR}"
mkdir -p "${DEB_DIR}/DEBIAN"
mkdir -p "${DEB_DIR}/opt/sshdesktop"
mkdir -p "${DEB_DIR}/usr/local/bin"
mkdir -p "${DEB_DIR}/usr/share/applications"
mkdir -p "${DEB_DIR}/usr/share/icons/hicolor/128x128/apps"
mkdir -p "${DEB_DIR}/etc/systemd/system"

# Control file
cat << EOF > "${DEB_DIR}/DEBIAN/control"
Package: ${APP_NAME}
Version: ${VERSION}
Section: utils
Priority: optional
Architecture: ${ARCH}
Maintainer: SSH Desktop Team <support@sshdesktop.app>
Depends: nodejs (>= 16.0.0) | curl
Homepage: ${HOMEPAGE}
Description: ${DESCRIPTION}
 SSH Desktop brings a macOS-inspired remote desktop environment to Linux
 servers with native SSH, SFTP, Web GUI on Port 2222, and OS deployment tools.
EOF

# Copy app files
cp -r dist "${DEB_DIR}/opt/sshdesktop/"
cp server.js "${DEB_DIR}/opt/sshdesktop/"
cp package.json "${DEB_DIR}/opt/sshdesktop/"
cp "${TAR_DIR}/bin/sshdesktop" "${DEB_DIR}/usr/local/bin/sshdesktop"
cp "${TAR_DIR}/share/applications/sshdesktop.desktop" "${DEB_DIR}/usr/share/applications/"
if [ -f "src-tauri/icons/128x128.png" ]; then
  cp src-tauri/icons/128x128.png "${DEB_DIR}/usr/share/icons/hicolor/128x128/apps/sshdesktop.png"
fi

# Systemd service in deb
cat << 'EOF' > "${DEB_DIR}/etc/systemd/system/sshdesktop.service"
[Unit]
Description=SSH Desktop Web Desktop Server (Port 2222)
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/sshdesktop
Environment=PORT=2222
Environment=HOST=0.0.0.0
ExecStart=/usr/bin/node /opt/sshdesktop/server.js
Restart=always

[Install]
WantedBy=multi-user.target
EOF

# Post-install script
cat << 'EOF' > "${DEB_DIR}/DEBIAN/postinst"
#!/bin/sh
set -e
chmod +x /usr/local/bin/sshdesktop
if command -v systemctl >/dev/null 2>&1; then
  systemctl daemon-reload || true
fi
if command -v ufw >/dev/null 2>&1; then
  ufw allow 2222/tcp comment 'SSH Desktop' >/dev/null 2>&1 || true
fi
echo "🎉 SSH Desktop v2.4.0 installed! Run 'sshdesktop' or 'systemctl start sshdesktop'"
EOF
chmod 755 "${DEB_DIR}/DEBIAN/postinst"

# If dpkg-deb is available, build the deb
if command -v dpkg-deb >/dev/null 2>&1; then
  dpkg-deb --build --root-owner-group "${DEB_DIR}" "${OUTPUT_DIR}/${APP_NAME}_${VERSION}_${ARCH}.deb" 2>/dev/null || \
  dpkg-deb --build "${DEB_DIR}" "${OUTPUT_DIR}/${APP_NAME}_${VERSION}_${ARCH}.deb"
  echo "✅ Created: ${OUTPUT_DIR}/${APP_NAME}_${VERSION}_${ARCH}.deb"
else
  echo "Notice: dpkg-deb not present on this machine. Generated deb tree at ${DEB_DIR}"
  # Generate tar archive representing the deb payload
  tar -czf "${OUTPUT_DIR}/${APP_NAME}_${VERSION}_${ARCH}.deb.tar.gz" -C "${BUILD_ROOT}" "${APP_NAME}_${VERSION}_${ARCH}"
fi

# Step 4: Generate RedHat .RPM package structure
echo "📦 Generating RedHat/Fedora/Rocky .rpm spec..."
RPM_BUILD="${BUILD_ROOT}/rpmbuild"
mkdir -p "${RPM_BUILD}/SPECS"
mkdir -p "${RPM_BUILD}/SOURCES"

cat << EOF > "${RPM_BUILD}/SPECS/sshdesktop.spec"
%define _unpackaged_files_terminate_build 0
%define debug_package %{nil}

Name:           ${APP_NAME}
Version:        ${VERSION}
Release:        1%{?dist}
Summary:        ${DESCRIPTION}

License:        MIT
URL:            ${HOMEPAGE}
BuildArch:      ${RPM_ARCH}
Requires:       nodejs >= 16

%description
SSH Desktop brings a macOS-inspired remote desktop environment to Linux
servers with native SSH, SFTP, Web GUI on Port 2222, and OS deployment tools.

%install
rm -rf %{buildroot}
mkdir -p %{buildroot}/opt/sshdesktop
mkdir -p %{buildroot}/usr/local/bin
mkdir -p %{buildroot}/usr/share/applications
mkdir -p %{buildroot}/usr/share/icons/hicolor/128x128/apps
mkdir -p %{buildroot}/etc/systemd/system

cp -r ${DEB_DIR}/opt/sshdesktop/* %{buildroot}/opt/sshdesktop/
cp ${DEB_DIR}/usr/local/bin/sshdesktop %{buildroot}/usr/local/bin/sshdesktop
cp ${DEB_DIR}/usr/share/applications/sshdesktop.desktop %{buildroot}/usr/share/applications/
cp ${DEB_DIR}/usr/share/icons/hicolor/128x128/apps/sshdesktop.png %{buildroot}/usr/share/icons/hicolor/128x128/apps/
cp ${DEB_DIR}/etc/systemd/system/sshdesktop.service %{buildroot}/etc/systemd/system/

%files
/opt/sshdesktop
/usr/local/bin/sshdesktop
/usr/share/applications/sshdesktop.desktop
/usr/share/icons/hicolor/128x128/apps/sshdesktop.png
/etc/systemd/system/sshdesktop.service

%post
chmod +x /usr/local/bin/sshdesktop
systemctl daemon-reload 2>/dev/null || true
firewall-cmd --permanent --add-port=2222/tcp 2>/dev/null && firewall-cmd --reload 2>/dev/null || true
echo "🎉 SSH Desktop v2.4.0 installed! Run 'sshdesktop' or 'systemctl start sshdesktop'"

%changelog
* Mon Oct 19 2026 SSH Desktop Team <support@sshdesktop.app> - 2.4.0-1
- Release v2.4.0 with Port 2222 Architecture, API Studio, and OS Hub
EOF

if command -v rpmbuild >/dev/null 2>&1; then
  rpmbuild --define "_topdir ${RPM_BUILD}" -bb "${RPM_BUILD}/SPECS/sshdesktop.spec"
  cp "${RPM_BUILD}/RPMS/${RPM_ARCH}/"*.rpm "${OUTPUT_DIR}/"
  echo "✅ Created: ${OUTPUT_DIR}/${APP_NAME}-${VERSION}-1.${RPM_ARCH}.rpm"
else
  echo "Notice: rpmbuild not present on this machine. Generated RPM spec at ${RPM_BUILD}/SPECS/sshdesktop.spec"
fi

echo ""
echo "================================================================="
echo "🎉 All Linux packages and distributions generated in:"
echo "   ${OUTPUT_DIR}"
echo "================================================================="
