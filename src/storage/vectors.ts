import type Database from "better-sqlite3";

export interface VectorSearchResult {
  chunkId: string;
  distance: number;
}

export function insertVector(
  db: Database.Database,
  chunkId: string,
  embedding: number[],
): void {
  const stmt = db.prepare(
    "INSERT INTO chunk_vectors (chunk_id, embedding) VALUES (?, ?)",
  );
  stmt.run(chunkId, new Float32Array(embedding));
}

export function searchVectors(
  db: Database.Database,
  queryEmbedding: number[],
  topK: number,
  collectionId?: string,
): VectorSearchResult[] {
  const embeddingBuf = new Float32Array(queryEmbedding);

  if (collectionId) {
    // sqlite-vec requires k=? in WHERE, can't JOIN on vec0 directly.
    // Over-retrieve then batch-filter by collection in a single query.
    const overRetrieve = topK * 3;
    const stmt = db.prepare(`
      SELECT chunk_id as chunkId, distance
      FROM chunk_vectors
      WHERE embedding MATCH ?
        AND k = ?
    `);
    const allResults = stmt.all(embeddingBuf, overRetrieve) as VectorSearchResult[];

    if (allResults.length === 0) return [];

    // Batch filter: single query with IN clause instead of N individual queries
    const placeholders = allResults.map(() => "?").join(",");
    const validIds = new Set(
      (db.prepare(`
        SELECT c.id FROM chunks c
        JOIN documents d ON d.id = c.document_id
        WHERE c.id IN (${placeholders}) AND d.collection_id = ?
      `).all(...allResults.map((r) => r.chunkId), collectionId) as { id: string }[])
        .map((r) => r.id)
    );

    const filtered: VectorSearchResult[] = [];
    for (const r of allResults) {
      if (filtered.length >= topK) break;
      if (validIds.has(r.chunkId)) filtered.push(r);
    }
    return filtered;
  }

  const stmt = db.prepare(`
    SELECT chunk_id as chunkId, distance
    FROM chunk_vectors
    WHERE embedding MATCH ?
      AND k = ?
  `);
  return stmt.all(embeddingBuf, topK) as VectorSearchResult[];
}

export function deleteVectors(
  db: Database.Database,
  chunkIds: string[],
): void {
  const stmt = db.prepare("DELETE FROM chunk_vectors WHERE chunk_id = ?");
  const deleteMany = db.transaction((ids: string[]) => {
    for (const id of ids) stmt.run(id);
  });
  deleteMany(chunkIds);
}
