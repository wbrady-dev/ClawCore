#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════
# ClawCore Clean-Machine Install Test
# Run this on a fresh machine (or in a clean Docker container)
# to verify the full install → smoke → test pipeline works.
#
# Prerequisites: Node.js 22+, Python 3.10+
# Usage: bash test/clean-install-test.sh [path-to-clawcore-archive]
# ═══════════════════════════════════════════════════════════════

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
DIM='\033[0;90m'
RESET='\033[0m'

pass=0
fail=0

check() {
  local name="$1"
  shift
  if "$@" > /dev/null 2>&1; then
    echo -e "  ${GREEN}✓${RESET} $name"
    ((pass++))
  else
    echo -e "  ${RED}✗${RESET} $name"
    ((fail++))
  fi
}

echo ""
echo "═══ ClawCore Clean-Machine Install Test ═══"
echo ""

# ── Prerequisites ──
echo "── Prerequisites ──"
check "Node.js 22+" node -e "if(parseInt(process.versions.node)<22)process.exit(1)"
check "Python 3+" python3 --version
check "npm available" npm --version

# ── Install ──
echo "── Install ──"
CLAWCORE_DIR="${1:-$(pwd)}"
cd "$CLAWCORE_DIR"
check "package.json exists" test -f package.json
check "npm install succeeds" npm install
check "memory-engine install succeeds" bash -c "cd memory-engine && npm install"

# ── Build ──
echo "── Build ──"
check "npm run build succeeds" npm run build
check "dist/index.mjs exists" test -f dist/index.mjs
check "dist/cli/clawcore.mjs exists" test -f dist/cli/clawcore.mjs

# ── Smoke ──
echo "── Smoke ──"
check "clawcore --version runs" node bin/clawcore.mjs --version
check "binary uses dist/ (not tsx)" grep -q "dist/cli/clawcore.mjs" bin/clawcore.mjs

# ── TypeScript ──
echo "── TypeScript ──"
check "tsc --noEmit passes" npx tsc --noEmit

# ── Unit Tests ──
echo "── Unit Tests ──"
check "vitest runs (full suite)" bash -c "cd memory-engine && npx vitest run 2>&1 | tail -1 | grep -q 'passed'"
check "stress test passes" bash -c "cd memory-engine && npx vitest run test/cram-stress.test.ts 2>&1 | tail -1 | grep -q 'passed'"
check "failure injection passes" bash -c "cd memory-engine && npx vitest run test/cram-failure-injection.test.ts 2>&1 | tail -1 | grep -q 'passed'"

# ── Schema Migration ──
echo "── Schema Migration ──"
check "graph DB created + migrations run" node --experimental-strip-types -e "
import { DatabaseSync } from 'node:sqlite';
import { runGraphMigrations } from './memory-engine/src/relations/schema.ts';
const db = new DatabaseSync(':memory:');
runGraphMigrations(db);
const v = db.prepare('SELECT COUNT(*) as cnt FROM _evidence_migrations').get();
if (v.cnt < 7) process.exit(1);
db.close();
"

# ── Skill Files ──
echo "── Skill Files ──"
check "clawcore-evidence skill exists" test -f skills/clawcore-evidence/SKILL.md
check "clawcore-knowledge skill exists" test -f skills/clawcore-knowledge/SKILL.md
check "no PII in evidence skill" bash -c "! grep -qi 'copper\|wbrad\|wesley' skills/clawcore-evidence/SKILL.md"
check "no PII in knowledge skill" bash -c "! grep -qi 'copper\|wbrad\|wesley' skills/clawcore-knowledge/SKILL.md"

# ── Distribution Cleanliness ──
echo "── Distribution Cleanliness ──"
check "no API keys in .env.example" bash -c "! grep -E '=[A-Za-z0-9]{20,}' .env.example 2>/dev/null || test ! -f .env.example"
check "no hardcoded user paths in source" bash -c "! grep -rn 'C:\\\\Users\\\\wbrad\|/Users/wbrad' src/ --include='*.ts' 2>/dev/null"
check "no copper references in source" bash -c "! grep -rn 'copper-' src/ --include='*.ts' 2>/dev/null"

# ── Docs ──
echo "── Docs ──"
check "README.md exists" test -f README.md
check "TECHNICAL.md exists" test -f TECHNICAL.md
check "docs/ directory exists" test -d docs
check "CRAM shorthand in README" grep -q "RAG + DAG + KG + AL" README.md
check "lossless-claw credited" grep -qi "martian\|lossless-claw\|voltropy" README.md

# ── Summary ──
echo ""
echo "═══════════════════════════════════════════"
echo -e "  RESULTS: ${GREEN}${pass} passed${RESET}, ${RED}${fail} failed${RESET}"
echo "═══════════════════════════════════════════"

exit $fail
