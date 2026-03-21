#!/bin/bash
cd "$(dirname "$0")/.."

echo "[update] Pulling latest from GitHub..."
git pull || { echo "[ERROR] git pull failed."; exit 1; }

echo "[update] Rebuilding..."
npx tsup || echo "[WARN] Build failed. TUI will use tsx fallback."

echo ""
echo "[OK] ClawCore updated. Restart the TUI to see changes."
