#!/bin/bash
# ClawCore startup wrapper
# Usage: ./start-clawcore.sh [--with-openclaw]

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

WITH_OPENCLAW=false
for arg in "$@"; do
  case "$arg" in
    --with-openclaw) WITH_OPENCLAW=true ;;
  esac
done

GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m'

log() { echo -e "${GREEN}[clawcore]${NC} $1"; }
err() { echo -e "${RED}[clawcore]${NC} $1"; }

wait_for_port() {
  local port=$1
  local name=$2
  local timeout=$3
  local elapsed=0

  while [ $elapsed -lt $timeout ]; do
    if curl -s "http://127.0.0.1:${port}/health" > /dev/null 2>&1; then
      log "$name ready on port $port"
      return 0
    fi
    sleep 2
    elapsed=$((elapsed + 2))
  done

  err "$name failed to start within ${timeout}s"
  return 1
}

MODELS_UP=false
API_UP=false

curl -s http://127.0.0.1:8012/health > /dev/null 2>&1 && MODELS_UP=true
curl -s http://127.0.0.1:18800/health > /dev/null 2>&1 && API_UP=true

if [ "$MODELS_UP" = true ] && [ "$API_UP" = true ]; then
  log "ClawCore already running (models :8012, API :18800)"
else
  if [ ! -d "$SCRIPT_DIR/node_modules" ] && [ ! -f "$SCRIPT_DIR/dist/cli/clawcore.js" ]; then
    err "ClawCore runtime files are missing. Run ./install.sh first."
    exit 1
  fi

  log "Starting ClawCore services..."
  node "$SCRIPT_DIR/bin/clawcore.mjs" serve &
  CLAWCORE_PID=$!

  log "Waiting for model server (this may take 30-60s on first load)..."
  wait_for_port 8012 "Model server" 120

  log "Waiting for ClawCore API..."
  wait_for_port 18800 "ClawCore API" 30
fi

if [ "$WITH_OPENCLAW" = true ]; then
  log "Starting OpenClaw gateway..."
  openclaw &
  OPENCLAW_PID=$!
  sleep 3
  log "OpenClaw started (PID=$OPENCLAW_PID)"
fi

log "All services running."
echo ""
echo "  Model Server:  http://127.0.0.1:8012/health"
echo "  ClawCore API:  http://127.0.0.1:18800/health"
if [ "$WITH_OPENCLAW" = true ]; then
  echo "  OpenClaw:      http://127.0.0.1:18789"
fi
echo ""

wait
