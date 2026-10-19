#!/usr/bin/env bash
# ==============================================================================
# CloudDesk 2.0 - Linux Package Generator
# Generates: .deb (Ubuntu/Debian), .rpm (Fedora/RHEL/Rocky), and .tar.gz (Portable)
# ==============================================================================

set -e

APP_NAME="clouddesk"
APP_TITLE="CloudDesk"
VERSION="2.4.0"
ARCH="amd64"
RPM_ARCH="x86_64"
DESCRIPTION="CloudDesk macOS Edition for Linux Remote Server Administration"
HOMEPAGE="https://github.com/clouddesk/clouddesk"

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
mkdir -p "${TAR_DIR}/share/clouddesk"
mkdir -p "${TAR_DIR}/share/applications"
mkdir -p "${TAR_DIR}/share/icons/hicolor/128x128/apps"

# Copy dist & server assets
cp -r dist "${TAR_DIR}/share/clouddesk/"
cp server.js "${TAR_DIR}/share/clouddesk/"
cp package.json "${TAR_DIR}/share/clouddesk/"

if [ -f "src-tauri/icons/128x128.png" ]; then
  cp src-tauri/icons/128x128.png "${TAR_DIR}/share/icons/hicolor/128x128/apps/clouddesk.png"
fi

# Launcher script
cat << 'EOF' > "${TAR_DIR}/bin/clouddesk"
#!/usr/bin/env bash
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${PORT:-2222}"
echo "🚀 Starting CloudDesk Web Desktop on Port ${PORT}..."
if command -v node >/dev/null 2>&1; then
  PORT="${PORT}" node "${DIR}/share/clouddesk/server.js"
else
  echo "Node.js runtime required. Please install nodejs."
  exit 1
fi
EOF
chmod +x "${TAR_DIR}/bin/clouddesk"

# Desktop entry
cat << EOF > "${TAR_DIR}/share/applications/clouddesk.desktop"
[Desktop Entry]
Name=${APP_TITLE}
Comment=${DESCRIPTION}
Exec=/usr/local/bin/clouddesk
Icon=clouddesk
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
mkdir -p /opt/clouddesk
cp -r "$DIR/share/clouddesk/"* /opt/clouddesk/
ln -sf /opt/clouddesk/server.js /usr/local/bin/clouddesk-server
cp "$DIR/bin/clouddesk" /usr/local/bin/clouddesk
chmod +x /usr/local/bin/clouddesk
if [ -f "$DIR/share/applications/clouddesk.desktop" ]; then
  cp "$DIR/share/applications/clouddesk.desktop" /usr/share/applications/
fi
if [ -f "$DIR/share/icons/hicolor/128x128/apps/clouddesk.png" ]; then
  mkdir -p /usr/share/icons/hicolor/128x128/apps
  cp "$DIR/share/icons/hicolor/128x128/apps/clouddesk.png" /usr/share/icons/hicolor/128x128/apps/
fi
echo "🎉 CloudDesk installed to /opt/clouddesk! Run with: clouddesk"
EOF
chmod +x "${TAR_DIR}/install.sh"

tar -czf "${OUTPUT_DIR}/${APP_NAME}-${VERSION}-linux-${RPM_ARCH}.tar.gz" -C "${BUILD_ROOT}" "${APP_NAME}-${VERSION}-linux-${RPM_ARCH}"
echo "✅ Created: ${OUTPUT_DIR}/${APP_NAME}-${VERSION}-linux-${RPM_ARCH}.tar.gz"

# Step 3: Generate Debian .DEB package structure
echo "📦 Generating Debian .deb package..."
DEB_DIR="${BUILD_ROOT}/${APP_NAME}_${VERSION}_${ARCH}"
rm -rf "${DEB_DIR}"
mkdir -p "${DEB_DIR}/DEBIAN"
mkdir -p "${DEB_DIR}/opt/clouddesk"
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
Maintainer: CloudDesk Team <support@clouddesk.app>
Depends: nodejs (>= 16.0.0) | curl
Homepage: ${HOMEPAGE}
Description: ${DESCRIPTION}
 CloudDesk brings a macOS-inspired remote desktop environment to Linux
 servers with native SSH, SFTP, Web GUI on Port 2222, and OS deployment tools.
EOF

# Copy app files
cp -r dist "${DEB_DIR}/opt/clouddesk/"
cp server.js "${DEB_DIR}/opt/clouddesk/"
cp package.json "${DEB_DIR}/opt/clouddesk/"
cp "${TAR_DIR}/bin/clouddesk" "${DEB_DIR}/usr/local/bin/clouddesk"
cp "${TAR_DIR}/share/applications/clouddesk.desktop" "${DEB_DIR}/usr/share/applications/"
if [ -f "src-tauri/icons/128x128.png" ]; then
  cp src-tauri/icons/128x128.png "${DEB_DIR}/usr/share/icons/hicolor/128x128/apps/clouddesk.png"
fi

# Systemd service in deb
cat << 'EOF' > "${DEB_DIR}/etc/systemd/system/clouddesk.service"
[Unit]
Description=CloudDesk Web Desktop Server (Port 2222)
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/clouddesk
Environment=PORT=2222
Environment=HOST=0.0.0.0
ExecStart=/usr/bin/node /opt/clouddesk/server.js
Restart=always

[Install]
WantedBy=multi-user.target
EOF

# Post-install script
cat << 'EOF' > "${DEB_DIR}/DEBIAN/postinst"
#!/bin/sh
set -e
chmod +x /usr/local/bin/clouddesk
if command -v systemctl >/dev/null 2>&1; then
  systemctl daemon-reload || true
fi
if command -v ufw >/dev/null 2>&1; then
  ufw allow 2222/tcp comment 'CloudDesk' >/dev/null 2>&1 || true
fi
echo "🎉 CloudDesk v2.4.0 installed! Run 'clouddesk' or 'systemctl start clouddesk'"
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

cat << EOF > "${RPM_BUILD}/SPECS/clouddesk.spec"
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
CloudDesk brings a macOS-inspired remote desktop environment to Linux
servers with native SSH, SFTP, Web GUI on Port 2222, and OS deployment tools.

%install
rm -rf %{buildroot}
mkdir -p %{buildroot}/opt/clouddesk
mkdir -p %{buildroot}/usr/local/bin
mkdir -p %{buildroot}/usr/share/applications
mkdir -p %{buildroot}/usr/share/icons/hicolor/128x128/apps
mkdir -p %{buildroot}/etc/systemd/system

cp -r ${DEB_DIR}/opt/clouddesk/* %{buildroot}/opt/clouddesk/
cp ${DEB_DIR}/usr/local/bin/clouddesk %{buildroot}/usr/local/bin/clouddesk
cp ${DEB_DIR}/usr/share/applications/clouddesk.desktop %{buildroot}/usr/share/applications/
cp ${DEB_DIR}/usr/share/icons/hicolor/128x128/apps/clouddesk.png %{buildroot}/usr/share/icons/hicolor/128x128/apps/
cp ${DEB_DIR}/etc/systemd/system/clouddesk.service %{buildroot}/etc/systemd/system/

%files
/opt/clouddesk
/usr/local/bin/clouddesk
/usr/share/applications/clouddesk.desktop
/usr/share/icons/hicolor/128x128/apps/clouddesk.png
/etc/systemd/system/clouddesk.service

%post
chmod +x /usr/local/bin/clouddesk
systemctl daemon-reload 2>/dev/null || true
firewall-cmd --permanent --add-port=2222/tcp 2>/dev/null && firewall-cmd --reload 2>/dev/null || true
echo "🎉 CloudDesk v2.4.0 installed! Run 'clouddesk' or 'systemctl start clouddesk'"

%changelog
* Mon Oct 19 2026 CloudDesk Team <support@clouddesk.app> - 2.4.0-1
- Release v2.4.0 with Port 2222 Architecture, API Studio, and OS Hub
EOF

if command -v rpmbuild >/dev/null 2>&1; then
  rpmbuild --define "_topdir ${RPM_BUILD}" -bb "${RPM_BUILD}/SPECS/clouddesk.spec"
  cp "${RPM_BUILD}/RPMS/${RPM_ARCH}/"*.rpm "${OUTPUT_DIR}/"
  echo "✅ Created: ${OUTPUT_DIR}/${APP_NAME}-${VERSION}-1.${RPM_ARCH}.rpm"
else
  echo "Notice: rpmbuild not present on this machine. Generated RPM spec at ${RPM_BUILD}/SPECS/clouddesk.spec"
fi

echo ""
echo "================================================================="
echo "🎉 All Linux packages and distributions generated in:"
echo "   ${OUTPUT_DIR}"
echo "================================================================="
