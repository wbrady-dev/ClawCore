/**
 * Invariant store — durable constraints and contract memory.
 */

import type { GraphDb, UpsertInvariantInput } from "./types.js";
import { logEvidence } from "./evidence-log.js";

export function upsertInvariant(
  db: GraphDb,
  input: UpsertInvariantInput,
): { invariantId: number; isNew: boolean } {
  const existing = db.prepare(
    "SELECT id FROM invariants WHERE scope_id = ? AND invariant_key = ?",
  ).get(input.scopeId, input.invariantKey) as { id: number } | undefined;

  db.prepare(`
    INSERT INTO invariants
      (scope_id, invariant_key, category, description, severity, enforcement_mode, status,
       source_type, source_id, source_detail)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(scope_id, invariant_key) DO UPDATE SET
      description = excluded.description,
      category = COALESCE(excluded.category, invariants.category),
      severity = excluded.severity,
      enforcement_mode = excluded.enforcement_mode,
      status = excluded.status,
      updated_at = strftime('%Y-%m-%dT%H:%M:%f', 'now')
  `).run(
    input.scopeId, input.invariantKey,
    input.category ?? null, input.description,
    input.severity ?? "warning", input.enforcementMode ?? "advisory",
    input.status ?? "active",
    input.sourceType ?? null, input.sourceId ?? null, input.sourceDetail ?? null,
  );

  const row = db.prepare(
    "SELECT id FROM invariants WHERE scope_id = ? AND invariant_key = ?",
  ).get(input.scopeId, input.invariantKey) as { id: number } | undefined;

  if (!row) {
    throw new Error(`upsertInvariant: not found after UPSERT`);
  }

  const isNew = !existing;

  logEvidence(db, {
    scopeId: input.scopeId,
    objectType: "invariant",
    objectId: row.id,
    eventType: isNew ? "create" : "update",
  });

  return { invariantId: row.id, isNew };
}

export interface InvariantRow {
  id: number;
  scope_id: number;
  invariant_key: string;
  category: string | null;
  description: string;
  severity: string;
  enforcement_mode: string;
  status: string;
  created_at: string;
  updated_at: string;
}

export function getActiveInvariants(
  db: GraphDb,
  scopeId: number,
  limit = 50,
): InvariantRow[] {
  return db.prepare(`
    SELECT * FROM invariants
    WHERE scope_id = ? AND status = 'active'
    ORDER BY
      CASE severity
        WHEN 'critical' THEN 0
        WHEN 'error' THEN 1
        WHEN 'warning' THEN 2
        WHEN 'info' THEN 3
        ELSE 4
      END ASC
    LIMIT ?
  `).all(scopeId, limit) as InvariantRow[];
}
