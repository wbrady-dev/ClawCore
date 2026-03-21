#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

echo ""
echo "  ========================================"
echo "   ClawCore - Guided Installer"
echo "  ========================================"
echo ""
echo "  This script bootstraps local dependencies and then"
echo "  launches the current guided ClawCore installer."
echo ""

if ! command -v node >/dev/null 2>&1; then
  echo "[ERROR] Node.js is not installed."
  echo "        Install Node.js 22+ from https://nodejs.org/"
  exit 1
fi

NODE_MAJOR="$(node -e "console.log(process.versions.node.split('.')[0])")"
if [ "$NODE_MAJOR" -lt 22 ]; then
  echo "[ERROR] Node.js $NODE_MAJOR detected. ClawCore requires Node.js 22+."
  exit 1
fi
echo "[OK] Node.js $(node --version)"

PYTHON_CMD=""
if command -v python3 >/dev/null 2>&1; then
  PYTHON_CMD="python3"
elif command -v python >/dev/null 2>&1; then
  PYTHON_CMD="python"
else
  echo "[ERROR] Python is not installed or not on PATH."
  exit 1
fi
echo "[OK] $($PYTHON_CMD --version)"

if [ ! -d "$SCRIPT_DIR/node_modules" ]; then
  echo ""
  echo "[bootstrap] Installing local Node.js dependencies..."
  npm install
  export CLAWCORE_SKIP_NODE_INSTALL=1
else
  echo "[OK] Local Node.js dependencies already present"
fi

echo ""
echo "[launch] Starting the guided installer..."
echo ""
exec node "$SCRIPT_DIR/bin/clawcore.mjs" install "$@"
