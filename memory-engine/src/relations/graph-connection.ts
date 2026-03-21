/**
 * Graph database connection manager using node:sqlite DatabaseSync.
 *
 * Mirrors the pattern from memory-engine/src/db/connection.ts but manages
 * connections to the separate clawcore-graph.db file.
 */

import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "fs";
import { dirname } from "path";

type ConnectionEntry = {
  db: DatabaseSync;
  refs: number;
};

const _connections = new Map<string, ConnectionEntry>();

function isConnectionHealthy(db: DatabaseSync): boolean {
  try {
    db.prepare("SELECT 1").get();
    return true;
  } catch {
    return false;
  }
}

function forceCloseConnection(entry: ConnectionEntry): void {
  try {
    entry.db.close();
  } catch {
    // Ignore close failures
  }
}

/**
 * Get a pooled connection to the graph database.
 * WAL mode, foreign keys ON, busy_timeout = 5000ms.
 */
export function getGraphConnection(dbPath: string): DatabaseSync {
  const existing = _connections.get(dbPath);
  if (existing) {
    if (isConnectionHealthy(existing.db)) {
      existing.refs += 1;
      return existing.db;
    }
    forceCloseConnection(existing);
    _connections.delete(dbPath);
  }

  // Ensure parent directory exists (skip for :memory:)
  if (dbPath !== ":memory:") {
    mkdirSync(dirname(dbPath), { recursive: true });
  }

  const db = new DatabaseSync(dbPath);

  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA busy_timeout = 5000");

  _connections.set(dbPath, { db, refs: 1 });
  return db;
}

/**
 * Release a graph database connection.
 * If no path is provided, closes all connections.
 */
export function closeGraphConnection(dbPath?: string): void {
  if (typeof dbPath === "string" && dbPath.trim()) {
    const entry = _connections.get(dbPath);
    if (!entry) return;
    entry.refs = Math.max(0, entry.refs - 1);
    if (entry.refs === 0) {
      forceCloseConnection(entry);
      _connections.delete(dbPath);
    }
    return;
  }

  for (const entry of _connections.values()) {
    forceCloseConnection(entry);
  }
  _connections.clear();
}
