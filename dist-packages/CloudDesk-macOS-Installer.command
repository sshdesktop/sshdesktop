#!/usr/bin/env bash
# CloudDesk macOS Launcher & Installer
echo "🍏 Launching CloudDesk macOS Edition..."
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PORT=2222
export PORT
if command -v node >/dev/null 2>&1; then
  node "$DIR/server.js" &
  SERVER_PID=$!
  sleep 1
  open "http://localhost:${PORT}"
  wait $SERVER_PID
else
  open "$DIR/dist/index.html"
fi
