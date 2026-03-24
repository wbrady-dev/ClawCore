import type Database from "better-sqlite3";
import { logger } from "../utils/logger.js";

export interface BM25SearchResult {
  rowid: number;
  chunkId: string;
  rank: number;
}

/**
 * Escape a query string for FTS5.
 * Strips all non-alphanumeric characters, then wraps each word in double
 * quotes to prevent FTS5 operator interpretation (AND, OR, NOT, etc.).
 * Returns null if the query contains no searchable terms.
 */
function escapeFts5Query(query: string): string | null {
  const words = query
    .replace(/[^\p{L}\p{N}\s_-]/gu, " ")
    .split(/\s+/)
    .filter((w) => w.length > 0);

  if (words.length === 0) return null;
  return words.map((w) => `"${w}"`).join(" ");
}

export function searchBm25(
  db: Database.Database,
  query: string,
  topK: number,
  collectionId?: string,
): BM25SearchResult[] {
  const ftsQuery = escapeFts5Query(query);
  if (!ftsQuery) return [];

  try {
    if (collectionId) {
      const stmt = db.prepare(`
        SELECT c.id as chunkId, c.rowid, rank
        FROM chunk_fts
        JOIN chunks c ON c.rowid = chunk_fts.rowid
        JOIN documents d ON d.id = c.document_id
        WHERE chunk_fts MATCH ?
          AND d.collection_id = ?
        ORDER BY rank
        LIMIT ?
      `);
      return stmt.all(ftsQuery, collectionId, topK) as BM25SearchResult[];
    }

    const stmt = db.prepare(`
      SELECT c.id as chunkId, c.rowid, rank
      FROM chunk_fts
      JOIN chunks c ON c.rowid = chunk_fts.rowid
      WHERE chunk_fts MATCH ?
      ORDER BY rank
      LIMIT ?
    `);
    return stmt.all(ftsQuery, topK) as BM25SearchResult[];
  } catch (err) {
    logger.warn({ query: ftsQuery, error: String(err) }, "BM25 search failed");
    return [];
  }
}
