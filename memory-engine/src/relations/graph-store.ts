/**
 * Graph store — entity CRUD, mention storage, re-ingestion cleanup.
 *
 * All functions accept a GraphDb interface so they work with both
 * node:sqlite DatabaseSync and better-sqlite3.
 */

import type {
  GraphDb,
  ExtractionResult,
  UpsertEntityInput,
  InsertMentionInput,
  StoreExtractionInput,
} from "./types.js";
import { logEvidence, withWriteTransaction } from "./evidence-log.js";
import { extractFast } from "./entity-extract.js";
import { invalidateAwarenessCache } from "./awareness.js";

// ---------------------------------------------------------------------------
// Entity upsert
// ---------------------------------------------------------------------------

export interface UpsertEntityResult {
  entityId: number;
  isNew: boolean;
}

/**
 * Insert or update an entity. Increments mention_count on conflict.
 * Name is lowercased + trimmed before storage.
 */
export function upsertEntity(db: GraphDb, input: UpsertEntityInput): UpsertEntityResult {
  const name = input.name.toLowerCase().trim();
  const displayName = input.displayName ?? input.name.trim();

  db.prepare(`
    INSERT INTO entities (name, display_name, entity_type, first_seen_at, last_seen_at, mention_count)
    VALUES (?, ?, ?, strftime('%Y-%m-%dT%H:%M:%f', 'now'), strftime('%Y-%m-%dT%H:%M:%f', 'now'), 1)
    ON CONFLICT(name) DO UPDATE SET
      mention_count = mention_count + 1,
      last_seen_at = strftime('%Y-%m-%dT%H:%M:%f', 'now'),
      display_name = CASE
        WHEN excluded.display_name IS NOT NULL AND length(excluded.display_name) > 0
        THEN excluded.display_name
        ELSE entities.display_name
      END
  `).run(name, displayName, input.entityType ?? null);

  const row = db.prepare(
    "SELECT id, mention_count FROM entities WHERE name = ?",
  ).get(name) as { id: number; mention_count: number } | undefined;

  if (!row) {
    throw new Error(`upsertEntity: entity "${name}" not found after UPSERT`);
  }

  // mention_count === 1 means this was a fresh INSERT, not an ON CONFLICT UPDATE
  invalidateAwarenessCache();
  return { entityId: row.id, isNew: row.mention_count === 1 };
}

// ---------------------------------------------------------------------------
// Mention insert
// ---------------------------------------------------------------------------

/**
 * Insert an entity mention. Returns false if already exists (idempotent).
 */
export function insertMention(db: GraphDb, input: InsertMentionInput): boolean {
  const contextTermsJson = input.contextTerms && input.contextTerms.length > 0
    ? JSON.stringify(input.contextTerms)
    : null;

  const result = db.prepare(`
    INSERT OR IGNORE INTO entity_mentions
      (entity_id, scope_id, source_type, source_id, source_detail, context_terms, actor, run_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    input.entityId,
    input.scopeId ?? null,
    input.sourceType,
    input.sourceId,
    input.sourceDetail ?? null,
    contextTermsJson,
    input.actor ?? "system",
    input.runId ?? null,
  );

  return result.changes > 0;
}

// ---------------------------------------------------------------------------
// Re-ingestion cleanup
// ---------------------------------------------------------------------------

export interface DeleteResult {
  entitiesAffected: number;
  mentionsDeleted: number;
  orphansRemoved: number;
}

/**
 * Delete all graph data for a given source. Decrements mention counts,
 * removes mentions, and cleans up orphaned entities.
 *
 * This function performs multiple SQL operations that must be atomic.
 * Callers MUST wrap this in a write transaction (withWriteTransaction or
 * better-sqlite3 .transaction()) to prevent partial cleanup on crash.
 */
export function deleteGraphDataForSource(
  db: GraphDb,
  sourceType: string,
  sourceId: string,
): DeleteResult {
  // Count mentions per entity for this source
  const counts = db.prepare(`
    SELECT entity_id, COUNT(*) as cnt FROM entity_mentions
    WHERE source_type = ? AND source_id = ?
    GROUP BY entity_id
  `).all(sourceType, sourceId) as Array<{ entity_id: number; cnt: number }>;

  // Decrement mention counts
  for (const { entity_id, cnt } of counts) {
    db.prepare(
      "UPDATE entities SET mention_count = MAX(0, mention_count - ?) WHERE id = ?",
    ).run(cnt, entity_id);
  }

  // Delete mentions
  const deleteResult = db.prepare(
    "DELETE FROM entity_mentions WHERE source_type = ? AND source_id = ?",
  ).run(sourceType, sourceId);

  // Clean orphans (mention_count <= 0)
  const orphanResult = db.prepare("DELETE FROM entities WHERE mention_count <= 0").run();

  // Invalidate awareness cache after graph mutations
  invalidateAwarenessCache();

  // Log the cleanup
  logEvidence(db, {
    scopeId: 0,
    objectType: "source",
    objectId: 0,
    eventType: "delete",
    payload: { sourceType, sourceId, mentionsDeleted: deleteResult.changes },
  });

  return {
    entitiesAffected: counts.length,
    mentionsDeleted: Number(deleteResult.changes),
    orphansRemoved: Number(orphanResult.changes),
  };
}

// ---------------------------------------------------------------------------
// Store extraction results
// ---------------------------------------------------------------------------

/**
 * Store a batch of extraction results: upsert entities, insert mentions,
 * and log evidence for each.
 */
export function storeExtractionResult(
  db: GraphDb,
  results: ExtractionResult[],
  input: StoreExtractionInput,
): void {
  for (const result of results) {
    const name = result.name.toLowerCase().trim();
    if (name.length === 0) continue;

    const { entityId } = upsertEntity(db, {
      name: result.name,
      displayName: result.name,
      entityType: result.entityType,
    });

    const inserted = insertMention(db, {
      entityId,
      scopeId: input.scopeId,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      sourceDetail: input.sourceDetail,
      contextTerms: result.contextTerms,
      actor: input.actor,
      runId: input.runId,
    });

    if (inserted) {
      logEvidence(db, {
        scopeId: input.scopeId,
        objectType: "entity",
        objectId: entityId,
        eventType: "mention_insert",
        actor: input.actor ?? "system",
        runId: input.runId,
        idempotencyKey: `extract:${input.sourceType}:${input.sourceId}:${name}`,
        payload: {
          confidence: result.confidence,
          strategy: result.strategy,
          sourceType: input.sourceType,
          sourceId: input.sourceId,
        },
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Atomic re-extraction for documents
// ---------------------------------------------------------------------------

/**
 * Atomically delete old graph data for a document and re-extract
 * from new chunks. Wrapped in a single transaction — if the process
 * crashes mid-way, the entire operation rolls back and old data is preserved.
 */
export function reExtractGraphForDocument(
  db: GraphDb,
  documentId: string,
  chunks: Array<{ text: string; position: number }>,
  opts: {
    actor?: string;
    runId?: string;
    scopeId?: number;
    termsListEntries?: string[];
  },
): void {
  withWriteTransaction(db, () => {
    // Step 1: delete old mentions + decrement counts + orphan cleanup
    deleteGraphDataForSource(db, "document", documentId);

    // Step 2: extract and store from new chunks
    for (let i = 0; i < chunks.length; i++) {
      const entities = extractFast(chunks[i].text, opts.termsListEntries);
      if (entities.length > 0) {
        storeExtractionResult(db, entities, {
          sourceType: "document",
          sourceId: documentId,
          sourceDetail: `chunk ${i}`,
          scopeId: opts.scopeId,
          actor: opts.actor,
          runId: opts.runId,
        });
      }
    }
  });
}
