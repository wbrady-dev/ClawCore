#!/bin/bash
# ClawCore Backup Script
# Creates hot backups of both databases using SQLite VACUUM INTO.
# Safe to run while services are active (WAL mode).
#
# Usage: ./scripts/backup.sh [backup_dir]
# Default: ~/backups/clawcore/YYYY-MM-DD

set -e

BACKUP_ROOT="${1:-$HOME/backups/clawcore}"
BACKUP_DIR="$BACKUP_ROOT/$(date +%Y-%m-%d)"
mkdir -p "$BACKUP_DIR"

echo "ClawCore Backup — $(date)"
echo "Destination: $BACKUP_DIR"
echo ""

# Find databases
CLAWCORE_DB="$HOME/.openclaw/services/clawcore/data/clawcore.db"
MEMORY_DB="$HOME/.openclaw/clawcore-memory.db"

# Backup ClawCore knowledge DB
if [ -f "$CLAWCORE_DB" ]; then
  echo "  Backing up clawcore.db..."
  sqlite3 "$CLAWCORE_DB" "VACUUM INTO '$BACKUP_DIR/clawcore.db'"
  SIZE=$(du -sh "$BACKUP_DIR/clawcore.db" | cut -f1)
  echo "  ✓ clawcore.db ($SIZE)"
else
  echo "  ⚠ clawcore.db not found at $CLAWCORE_DB"
fi

# Backup Memory Engine DB
if [ -f "$MEMORY_DB" ]; then
  echo "  Backing up clawcore-memory.db..."
  sqlite3 "$MEMORY_DB" "VACUUM INTO '$BACKUP_DIR/clawcore-memory.db'"
  SIZE=$(du -sh "$BACKUP_DIR/clawcore-memory.db" | cut -f1)
  echo "  ✓ clawcore-memory.db ($SIZE)"
else
  echo "  ⚠ clawcore-memory.db not found at $MEMORY_DB"
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
