/**
 * Graph store — entity CRUD, mention storage, re-ingestion cleanup.
 *
 * Phase 2: upsertEntity and insertMention delegate to mo-store.ts.
 * deleteGraphDataForSource uses deleteMemoryObjectsBySource.
 * storeExtractionResult delegates to the rewritten functions.
 *
 * All functions accept a GraphDb interface so they work with both
 * node:sqlite DatabaseSync and better-sqlite3.
 *
 * Function signatures are UNCHANGED — callers don't need to change.
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
import { upsertMemoryObject, deleteMemoryObjectsBySource } from "../ontology/mo-store.js";
import type { MemoryObject } from "../ontology/types.js";

// ---------------------------------------------------------------------------
// Entity upsert
// ---------------------------------------------------------------------------

export interface UpsertEntityResult {
  entityId: number;
  isNew: boolean;
}

/**
 * Insert or update an entity. Uses memory_objects kind='entity'.
 * Name is lowercased + trimmed before storage.
 */
export function upsertEntity(db: GraphDb, input: UpsertEntityInput): UpsertEntityResult {
  const name = input.name.toLowerCase().trim();
  const displayName = input.displayName ?? input.name.trim();

  const compositeId = `entity:${name}`;

  // Check existing to increment mentionCount
  let mentionCount = 1;
  const existingRow = db.prepare(
    "SELECT structured_json FROM memory_objects WHERE composite_id = ?",
  ).get(compositeId) as { structured_json: string | null } | undefined;
  if (existingRow?.structured_json) {
    try {
      const parsed = JSON.parse(existingRow.structured_json);
      mentionCount = (Number(parsed.mentionCount) || 0) + 1;
    } catch { /* empty */ }
  }

  const mo: MemoryObject = {
    id: compositeId,
    kind: "entity",
    content: displayName,
    structured: {
      name,
      displayName,
      entityType: input.entityType ?? null,
      mentionCount,
    },
    canonical_key: `entity::${name}`,
    provenance: {
      source_kind: "extraction",
      source_id: compositeId,
      actor: "system",
      trust: 0.5,
    },
    confidence: 0.5,
    freshness: 1.0,
    provisional: false,
    status: "active",
    observed_at: new Date().toISOString(),
    scope_id: 1,
    influence_weight: "standard",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const result = upsertMemoryObject(db, mo);

  invalidateAwarenessCache();
  return { entityId: result.moId, isNew: result.isNew };
}

// ---------------------------------------------------------------------------
// Mention insert
// ---------------------------------------------------------------------------

/**
 * Insert an entity mention. Writes to provenance_links with predicate='mentioned_in'.
 * Returns false if already exists (idempotent).
 */
export function insertMention(db: GraphDb, input: InsertMentionInput): boolean {
  const contextTermsJson = input.contextTerms && input.contextTerms.length > 0
    ? JSON.stringify(input.contextTerms)
    : null;

  // Look up the composite_id for this entity (for provenance_links subject_id consistency)
  const entityRow = db.prepare(
    "SELECT composite_id FROM memory_objects WHERE id = ?",
  ).get(input.entityId) as { composite_id: string } | undefined;
  const subjectId = entityRow?.composite_id ?? `entity:${input.entityId}`;

  const result = db.prepare(`
    INSERT OR IGNORE INTO provenance_links
      (subject_id, predicate, object_id, confidence, detail, scope_id, metadata)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    subjectId,
    "mentioned_in",
    `${input.sourceType}:${input.sourceId}`,
    1.0,
    input.sourceDetail ?? null,
    input.scopeId ?? 1,
    JSON.stringify({
      context_terms: contextTermsJson,
      actor: input.actor ?? "system",
      run_id: input.runId ?? null,
    }),
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
 * Delete all graph data for a given source. Removes from memory_objects
 * and provenance_links.
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
  // Count mentions (provenance_links with mentioned_in) for this source
  const objectKey = `${sourceType}:${sourceId}`;

  let mentionsDeleted = 0;
  try {
    const deleteResult = db.prepare(
      "DELETE FROM provenance_links WHERE object_id = ? AND predicate = 'mentioned_in'",
    ).run(objectKey);
    mentionsDeleted = Number(deleteResult.changes);
  } catch { /* non-fatal */ }

  // Delete memory_objects from this source
  deleteMemoryObjectsBySource(db, sourceType, sourceId);

  // Invalidate awareness cache after graph mutations
  invalidateAwarenessCache();

  // Log the cleanup
  logEvidence(db, {
    scopeId: 1,
    objectType: "source",
    objectId: 0,
    eventType: "delete",
    payload: { sourceType, sourceId, mentionsDeleted },
  });

  return {
    entitiesAffected: 0,
    mentionsDeleted,
    orphansRemoved: 0,
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
    // Step 1: delete old mentions + memory objects for this source
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
