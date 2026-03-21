/**
 * State delta store — recording state changes over time.
 */

import type { GraphDb, RecordStateDeltaInput } from "./types.js";
import { logEvidence } from "./evidence-log.js";

export function recordStateDelta(db: GraphDb, input: RecordStateDeltaInput): number {
  const branchId = input.branchId ?? 0;

  const result = db.prepare(`
    INSERT INTO state_deltas
      (scope_id, branch_id, delta_type, entity_key, summary, old_value, new_value,
       confidence, source_type, source_id, source_detail)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    input.scopeId, branchId, input.deltaType, input.entityKey,
    input.summary ?? null, input.oldValue ?? null, input.newValue ?? null,
    input.confidence ?? null,
    input.sourceType ?? null, input.sourceId ?? null, input.sourceDetail ?? null,
  );

  const deltaId = Number(result.lastInsertRowid);

  logEvidence(db, {
    scopeId: input.scopeId,
    branchId: branchId || undefined,
    objectType: "state_delta",
    objectId: deltaId,
    eventType: "record",
  });

  return deltaId;
}

export interface DeltaRow {
  id: number;
  scope_id: number;
  delta_type: string;
  entity_key: string;
  summary: string | null;
  old_value: string | null;
  new_value: string | null;
  confidence: number | null;
  created_at: string;
  source_type: string | null;
  source_id: string | null;
}

export function getRecentDeltas(
  db: GraphDb,
  scopeId: number,
  opts?: { since?: string; limit?: number },
): DeltaRow[] {
  const limit = opts?.limit ?? 20;
  if (opts?.since) {
    return db.prepare(`
      SELECT * FROM state_deltas
      WHERE scope_id = ? AND created_at >= ?
      ORDER BY created_at DESC, id DESC LIMIT ?
    `).all(scopeId, opts.since, limit) as DeltaRow[];
  }
  return db.prepare(`
    SELECT * FROM state_deltas
    WHERE scope_id = ?
    ORDER BY created_at DESC, id DESC LIMIT ?
  `).all(scopeId, limit) as DeltaRow[];
}
