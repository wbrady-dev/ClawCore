/**
 * Graph database connection for the main ThreadClaw process (better-sqlite3).
 *
 * Opens `threadclaw-graph.db` with WAL mode and the same pragmas
 * as the memory-engine's node:sqlite opener.
 */

import Database from "better-sqlite3";
import { mkdirSync } from "fs";
import { dirname, resolve } from "path";
import { logger } from "../utils/logger.js";

let graphDb: Database.Database | null = null;
let storedGraphPath: string | null = null;

export function getGraphDb(dbPath: string): Database.Database {
  const normalized = resolve(dbPath);
  if (graphDb) {
    if (storedGraphPath && storedGraphPath !== normalized) {
      logger.warn(
        { expected: storedGraphPath, received: normalized },
        "getGraphDb called with different path — returning existing connection",
      );
    }
    return graphDb;
  }
  storedGraphPath = normalized;

  mkdirSync(dirname(normalized), { recursive: true });

  graphDb = new Database(normalized);
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
