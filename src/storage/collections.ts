import type Database from "better-sqlite3";
import { v4 as uuidv4 } from "uuid";

export interface Collection {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
}

export interface CollectionStats {
  id: string;
  name: string;
  documentCount: number;
  chunkCount: number;
  totalTokens: number;
  lastUpdated: string | null;
}

export function createCollection(
  db: Database.Database,
  name: string,
  description?: string,
): Collection {
  const id = uuidv4();
  db.prepare(
    "INSERT INTO collections (id, name, description) VALUES (?, ?, ?)",
  ).run(id, name, description ?? null);

  return getCollection(db, id)!;
}

export function getCollection(
  db: Database.Database,
  id: string,
): Collection | null {
  return (
    (db
      .prepare("SELECT * FROM collections WHERE id = ?")
      .get(id) as Collection) ?? null
  );
}

export function getCollectionByName(
  db: Database.Database,
  name: string,
): Collection | null {
  return (
    (db
      .prepare("SELECT * FROM collections WHERE name = ?")
      .get(name) as Collection) ?? null
  );
}

export function listCollections(db: Database.Database): Collection[] {
  return db
    .prepare("SELECT * FROM collections ORDER BY created_at")
    .all() as Collection[];
}

export function deleteCollection(db: Database.Database, id: string): void {
  // Delete vectors for chunks in this collection
  db.prepare(
    `DELETE FROM chunk_vectors WHERE chunk_id IN (
      SELECT c.id FROM chunks c
      JOIN documents d ON d.id = c.document_id
      WHERE d.collection_id = ?
    )`,
  ).run(id);

  // Cascading deletes handle documents -> chunks -> metadata_index
  db.prepare("DELETE FROM collections WHERE id = ?").run(id);
}

export function getCollectionStats(
  db: Database.Database,
  id: string,
): CollectionStats | null {
  const collection = getCollection(db, id);
  if (!collection) return null;

  const stats = db
    .prepare(
      `
    SELECT
      COUNT(DISTINCT d.id) as documentCount,
      COUNT(c.id) as chunkCount,
      COALESCE(SUM(c.token_count), 0) as totalTokens,
      MAX(d.created_at) as lastUpdated
    FROM documents d
    LEFT JOIN chunks c ON c.document_id = d.id
    WHERE d.collection_id = ?
  `,
    )
    .get(id) as {
    documentCount: number;
    chunkCount: number;
    totalTokens: number;
    lastUpdated: string | null;
  };

  return {
    id: collection.id,
    name: collection.name,
    ...stats,
  };
}

export function ensureCollection(
  db: Database.Database,
  name: string,
): Collection {
  const existing = getCollectionByName(db, name);
  if (existing) return existing;
  return createCollection(db, name);
}
