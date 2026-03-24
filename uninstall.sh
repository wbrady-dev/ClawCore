#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

echo ""
echo "  ========================================"
echo "   ThreadClaw - Guided Uninstaller"
echo "  ========================================"
echo ""
echo "  This script launches the current guided"
echo "  ThreadClaw uninstaller from this checkout."
echo ""

if ! command -v node >/dev/null 2>&1; then
  echo "[ERROR] Node.js is required to run the guided uninstaller."
  exit 1
fi

if [ ! -d "$SCRIPT_DIR/node_modules" ] && [ ! -f "$SCRIPT_DIR/dist/cli/threadclaw.js" ]; then
  echo "[ERROR] ThreadClaw runtime files are missing."
  echo "        Reinstall local dependencies or use manual cleanup."
  exit 1
fi

exec node "$SCRIPT_DIR/bin/threadclaw.mjs" uninstall "$@"
