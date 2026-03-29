/**
 * Graph database connection — delegates to the main ThreadClaw DB singleton.
 *
 * After database consolidation, graph tables (memory_objects, provenance_links,
 * evidence_log, etc.) live in the same threadclaw.db alongside RAG tables.
 * This module preserves the getGraphDb/closeGraphDb API so callers don't change.
 */

import type Database from "better-sqlite3";
import { getDb } from "./sqlite.js";

/**
 * Returns the main ThreadClaw database (same instance as getDb()).
 * The dbPath argument is accepted for backward compatibility but ignored —
 * the singleton is always the main DB initialized by server.ts.
 */
export function getGraphDb(_dbPath?: string): Database.Database {
  return getDb();
}

/** No-op — lifecycle is managed by closeDb() in sqlite.ts. */
export function closeGraphDb(): void {
  // Intentionally empty — DB closed via closeDb()
}
