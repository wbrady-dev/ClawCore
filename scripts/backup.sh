#!/bin/bash
# ThreadClaw Backup Script
# Creates hot backups of both databases using SQLite VACUUM INTO.
# Safe to run while services are active (WAL mode).
#
# Usage: ./scripts/backup.sh [backup_dir]
# Default: ~/backups/threadclaw/YYYY-MM-DD

set -e

BACKUP_ROOT="${1:-$HOME/backups/threadclaw}"
BACKUP_DIR="$BACKUP_ROOT/$(date +%Y-%m-%d)"
mkdir -p "$BACKUP_DIR"

echo "ThreadClaw Backup — $(date)"
echo "Destination: $BACKUP_DIR"
echo ""

# Find databases
THREADCLAW_DB="$HOME/.openclaw/services/threadclaw/data/threadclaw.db"
MEMORY_DB="$HOME/.openclaw/threadclaw-memory.db"

# Backup ThreadClaw knowledge DB
if [ -f "$THREADCLAW_DB" ]; then
  echo "  Backing up threadclaw.db..."
  sqlite3 "$THREADCLAW_DB" "VACUUM INTO '$BACKUP_DIR/threadclaw.db'"
  SIZE=$(du -sh "$BACKUP_DIR/threadclaw.db" | cut -f1)
  echo "  ✓ threadclaw.db ($SIZE)"
else
  echo "  ⚠ threadclaw.db not found at $THREADCLAW_DB"
fi

# Backup Memory Engine DB
if [ -f "$MEMORY_DB" ]; then
  echo "  Backing up threadclaw-memory.db..."
  sqlite3 "$MEMORY_DB" "VACUUM INTO '$BACKUP_DIR/threadclaw-memory.db'"
  SIZE=$(du -sh "$BACKUP_DIR/threadclaw-memory.db" | cut -f1)
  echo "  ✓ threadclaw-memory.db ($SIZE)"
else
  echo "  ⚠ threadclaw-memory.db not found at $MEMORY_DB"
fi

# Prune old backups (keep 30 days)
RETENTION_DAYS=30
if [ -d "$BACKUP_ROOT" ]; then
  OLD=$(find "$BACKUP_ROOT" -maxdepth 1 -type d -mtime +$RETENTION_DAYS 2>/dev/null | wc -l)
  if [ "$OLD" -gt 0 ]; then
    find "$BACKUP_ROOT" -maxdepth 1 -type d -mtime +$RETENTION_DAYS -exec rm -rf {} +
    echo "  Pruned $OLD backups older than $RETENTION_DAYS days"
  fi
fi

echo ""
echo "Backup complete."
