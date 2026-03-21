/**
 * Graph database connection for the main ClawCore process (better-sqlite3).
 *
 * Opens `clawcore-graph.db` with WAL mode and the same pragmas
 * as the memory-engine's node:sqlite opener.
 */

import Database from "better-sqlite3";
import { mkdirSync } from "fs";
import { dirname } from "path";

let graphDb: Database.Database | null = null;

export function getGraphDb(dbPath: string): Database.Database {
  if (graphDb) return graphDb;

  mkdirSync(dirname(dbPath), { recursive: true });

  graphDb = new Database(dbPath);
  graphDb.pragma("journal_mode = WAL");
  graphDb.pragma("foreign_keys = ON");
  graphDb.pragma("busy_timeout = 5000");

  return graphDb;
}

export function closeGraphDb(): void {
  if (graphDb) {
    const ref = graphDb;
    graphDb = null;
    try {
      ref.pragma("wal_checkpoint(TRUNCATE)");
    } catch {
      // Non-critical
    }
    try {
      ref.close();
    } catch {
      // Ignore close errors
    }
  }
}
