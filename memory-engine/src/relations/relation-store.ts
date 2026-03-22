/**
 * Relation store — entity-to-entity relationships extracted by deep mode.
 */

import type { GraphDb } from "./types.js";
import { logEvidence } from "./evidence-log.js";

export interface UpsertRelationInput {
  scopeId: number;
  subjectEntityId: number;
  predicate: string;
  objectEntityId: number;
  confidence?: number;
  sourceType: string;
  sourceId: string;
}

export interface RelationRow {
  id: number;
  scope_id: number;
  subject_entity_id: number;
  predicate: string;
  object_entity_id: number;
  confidence: number;
  source_type: string;
  source_id: string;
  created_at: string;
}

export function upsertRelation(
  db: GraphDb,
  input: UpsertRelationInput,
): { relationId: number; isNew: boolean } {
  const existing = db.prepare(
    "SELECT id FROM entity_relations WHERE scope_id = ? AND subject_entity_id = ? AND predicate = ? AND object_entity_id = ?",
  ).get(input.scopeId, input.subjectEntityId, input.predicate, input.objectEntityId) as { id: number } | undefined;

  db.prepare(`
    INSERT INTO entity_relations
      (scope_id, subject_entity_id, predicate, object_entity_id, confidence, source_type, source_id)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(scope_id, subject_entity_id, predicate, object_entity_id) DO UPDATE SET
      confidence = (entity_relations.confidence + excluded.confidence) / 2.0
  `).run(
    input.scopeId, input.subjectEntityId, input.predicate, input.objectEntityId,
    input.confidence ?? 0.5, input.sourceType, input.sourceId,
  );

  const row = db.prepare(
    "SELECT id FROM entity_relations WHERE scope_id = ? AND subject_entity_id = ? AND predicate = ? AND object_entity_id = ?",
  ).get(input.scopeId, input.subjectEntityId, input.predicate, input.objectEntityId) as { id: number };

  const isNew = !existing;

  logEvidence(db, {
    scopeId: input.scopeId,
    objectType: "relation",
    objectId: row.id,
    eventType: isNew ? "create" : "update",
    payload: { predicate: input.predicate },
  });

  return { relationId: row.id, isNew };
}

/**
 * Get relations for an entity (as subject, object, or both).
 */
export function getRelationsForEntity(
  db: GraphDb,
  entityId: number,
  direction: "subject" | "object" | "both" = "both",
): Array<RelationRow & { subject_name: string; object_name: string }> {
  if (direction === "subject") {
    return db.prepare(`
      SELECT r.*, e1.display_name AS subject_name, e2.display_name AS object_name
      FROM entity_relations r
      JOIN entities e1 ON r.subject_entity_id = e1.id
      JOIN entities e2 ON r.object_entity_id = e2.id
      WHERE r.subject_entity_id = ?
      ORDER BY r.confidence DESC
    `).all(entityId) as Array<RelationRow & { subject_name: string; object_name: string }>;
  }
  if (direction === "object") {
    return db.prepare(`
      SELECT r.*, e1.display_name AS subject_name, e2.display_name AS object_name
      FROM entity_relations r
      JOIN entities e1 ON r.subject_entity_id = e1.id
      JOIN entities e2 ON r.object_entity_id = e2.id
      WHERE r.object_entity_id = ?
      ORDER BY r.confidence DESC
    `).all(entityId) as Array<RelationRow & { subject_name: string; object_name: string }>;
  }
  return db.prepare(`
    SELECT r.*, e1.display_name AS subject_name, e2.display_name AS object_name
    FROM entity_relations r
    JOIN entities e1 ON r.subject_entity_id = e1.id
    JOIN entities e2 ON r.object_entity_id = e2.id
    WHERE r.subject_entity_id = ? OR r.object_entity_id = ?
    ORDER BY r.confidence DESC
  `).all(entityId, entityId) as Array<RelationRow & { subject_name: string; object_name: string }>;
}

/**
 * Get the relation graph for a scope.
 */
export function getRelationGraph(
  db: GraphDb,
  scopeId: number,
  opts?: { predicate?: string; limit?: number },
): Array<RelationRow & { subject_name: string; object_name: string }> {
  const limit = opts?.limit ?? 50;
  const where = ["r.scope_id = ?"];
  const args: unknown[] = [scopeId];

  if (opts?.predicate) {
    where.push("r.predicate = ?");
    args.push(opts.predicate);
  }

  args.push(limit);
  return db.prepare(`
    SELECT r.*, e1.display_name AS subject_name, e2.display_name AS object_name
    FROM entity_relations r
    JOIN entities e1 ON r.subject_entity_id = e1.id
    JOIN entities e2 ON r.object_entity_id = e2.id
    WHERE ${where.join(" AND ")}
    ORDER BY r.confidence DESC
    LIMIT ?
  `).all(...args) as Array<RelationRow & { subject_name: string; object_name: string }>;
}
