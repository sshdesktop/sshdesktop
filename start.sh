#!/usr/bin/env bash
# ==============================================================================
# SSH Desktop - All-in-One Engine Runner
# Frontend Port: 2222 | Backend Port: 2020
# ==============================================================================

set -e

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"

export FRONTEND_PORT="${FRONTEND_PORT:-2222}"
export BACKEND_PORT="${BACKEND_PORT:-2020}"
export HOST="${HOST:-0.0.0.0}"

echo "================================================================"
echo "🚀 SSH Desktop All-in-One Engine Starting..."
echo "🌐 Frontend UI:  http://${HOST}:${FRONTEND_PORT}"
echo "⚡ Backend API:  http://${HOST}:${BACKEND_PORT}"
echo "🔑 Login:        admin / sshdesktop"
echo "================================================================"

if [ -f "./sshdesktop" ] && [ -x "./sshdesktop" ]; then
  exec ./sshdesktop
elif [ -f "./bin/sshdesktop-linux-x64" ] && [ -x "./bin/sshdesktop-linux-x64" ]; then
  exec ./bin/sshdesktop-linux-x64
elif [ -f "/usr/local/bin/sshdesktop" ] && [ -x "/usr/local/bin/sshdesktop" ]; then
  exec /usr/local/bin/sshdesktop
elif command -v node >/dev/null 2>&1; then
  exec node server.js
else
  echo "[ERROR] Standalone binary 'sshdesktop' or 'node' runtime not found."
  echo "Download the binary from GitHub Releases or install Node.js."
  exit 1
fi
