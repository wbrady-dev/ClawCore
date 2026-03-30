/**
 * Graph database connection.
 *
 * The memory engine may write graph tables (memory_objects, provenance_links,
 * evidence_log, etc.) to a DIFFERENT database than the RAG server's main DB.
 * This module handles both cases:
 *   - Same DB: returns the main singleton (getDb())
 *   - Different DB: opens a separate readonly connection to the graph DB path
 */

import { resolve } from "path";
import BetterSqlite3 from "better-sqlite3";
import type Database from "better-sqlite3";
import { getDb } from "./sqlite.js";
import { config } from "../config.js";

let _separateGraphDb: Database.Database | null = null;

/**
 * Returns the database containing graph/evidence tables.
 * If the configured graphDbPath points to the same file as the main RAG DB,
 * returns the existing singleton. Otherwise opens a readonly connection to
 * the separate graph DB.
 */
export function getGraphDb(dbPath?: string): Database.Database {
  const graphPath = dbPath ?? config.relations?.graphDbPath;
  if (!graphPath) return getDb();

  // If graph DB is the same file as the main DB, return the singleton
  try {
    const mainDb = getDb();
    if (resolve(graphPath) === resolve(mainDb.name)) {
      return mainDb;
    }
  } catch {
    // getDb() may throw if not initialized yet — fall through to separate connection
  }

  // Different file — open a separate connection (cached)
  if (_separateGraphDb && _separateGraphDb.open) {
    return _separateGraphDb;
  }

  _separateGraphDb = new BetterSqlite3(graphPath, { readonly: false });
  _separateGraphDb.pragma("journal_mode = WAL");
  _separateGraphDb.pragma("busy_timeout = 5000");
  return _separateGraphDb;
}

/** Close the separate graph DB connection if one was opened. */
export function closeGraphDb(): void {
  if (_separateGraphDb) {
    try { _separateGraphDb.close(); } catch {}
    _separateGraphDb = null;
  }
}
