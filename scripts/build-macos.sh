#!/usr/bin/env bash
# ==============================================================================
# SSH Desktop 2.0 - macOS Package Generator (.app & .dmg)
# ==============================================================================

set -e

APP_NAME="SSH Desktop"
VERSION="2.4.0"
OUTPUT_DIR="$(pwd)/dist-packages"
BUILD_ROOT="$(pwd)/target/macos-packages"

echo "🍎 Building macOS Package for ${APP_NAME} v${VERSION}..."
mkdir -p "${OUTPUT_DIR}"
mkdir -p "${BUILD_ROOT}"

# Step 1: Ensure frontend build exists
if [ ! -d "dist" ]; then
  npm run build
fi

# Step 2: Create .app bundle structure
APP_BUNDLE="${BUILD_ROOT}/${APP_NAME}.app"
rm -rf "${APP_BUNDLE}"
mkdir -p "${APP_BUNDLE}/Contents/MacOS"
mkdir -p "${APP_BUNDLE}/Contents/Resources"

# Info.plist
cat << EOF > "${APP_BUNDLE}/Contents/Info.plist"
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleExecutable</key>
    <string>${APP_NAME}</string>
    <key>CFBundleIconFile</key>
    <string>icon.icns</string>
    <key>CFBundleIdentifier</key>
    <string>com.sshdesktop.desktop</string>
    <key>CFBundleInfoDictionaryVersion</key>
    <string>6.0</string>
    <key>CFBundleName</key>
    <string>${APP_NAME}</string>
    <key>CFBundlePackageType</key>
    <string>APPL</string>
    <key>CFBundleShortVersionString</key>
    <string>${VERSION}</string>
    <key>CFBundleVersion</key>
    <string>${VERSION}</string>
    <key>LSMinimumSystemVersion</key>
    <string>10.15</string>
    <key>NSHighResolutionCapable</key>
    <true/>
</dict>
</plist>
EOF

# Copy Icon
if [ -f "src-tauri/icons/icon.icns" ]; then
  cp src-tauri/icons/icon.icns "${APP_BUNDLE}/Contents/Resources/icon.icns"
fi

# Copy web dist & server into bundle resources
mkdir -p "${APP_BUNDLE}/Contents/Resources/app"
cp -r dist "${APP_BUNDLE}/Contents/Resources/app/"
cp server.js "${APP_BUNDLE}/Contents/Resources/app/"
cp package.json "${APP_BUNDLE}/Contents/Resources/app/"

# macOS executable launcher
cat << 'EOF' > "${APP_BUNDLE}/Contents/MacOS/${APP_NAME}"
#!/usr/bin/env bash
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../Resources/app" && pwd)"
PORT=2222
export PORT
# Start background server
if command -v node >/dev/null 2>&1; then
  node "${DIR}/server.js" &
  SERVER_PID=$!
  sleep 1
  open "http://localhost:${PORT}"
  wait $SERVER_PID
else
  # Native open fallback
  open "${DIR}/dist/index.html"
fi
EOF
chmod +x "${APP_BUNDLE}/Contents/MacOS/${APP_NAME}"

echo "✅ Created macOS App Bundle: ${APP_BUNDLE}"

# Step 3: Create .DMG Disk Image
if command -v hdiutil >/dev/null 2>&1; then
  DMG_PATH="${OUTPUT_DIR}/${APP_NAME}-${VERSION}.dmg"
  rm -f "${DMG_PATH}"
  echo "💿 Creating DMG Disk Image..."
  
  DMG_TEMP="${BUILD_ROOT}/dmg_temp"
  rm -rf "${DMG_TEMP}"
  mkdir -p "${DMG_TEMP}"
  cp -R "${APP_BUNDLE}" "${DMG_TEMP}/"
  ln -s /Applications "${DMG_TEMP}/Applications"
  
  hdiutil create -volname "${APP_NAME}" -srcfolder "${DMG_TEMP}" -ov -format UDZO "${DMG_PATH}"
  echo "✅ Created macOS DMG: ${DMG_PATH}"
else
  echo "Notice: hdiutil not present (not running on macOS). Creating zipped .app archive..."
  tar -czf "${OUTPUT_DIR}/${APP_NAME}-${VERSION}-macOS.tar.gz" -C "${BUILD_ROOT}" "${APP_NAME}.app"
  echo "✅ Created: ${OUTPUT_DIR}/${APP_NAME}-${VERSION}-macOS.tar.gz"
fi
