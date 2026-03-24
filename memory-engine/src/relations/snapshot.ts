/**
 * Snapshot queries — point-in-time state inspection.
 *
 * Phase 3: Queries memory_objects with timestamp filters to reconstruct
 * what the state looked like at a given moment. Uses status + updated_at
 * to determine which items were still active at a timestamp.
 */

import type { GraphDb } from "./types.js";
import { moRowToClaimRow, type ClaimRow } from "./claim-store.js";
import { moRowToDecisionRow, type DecisionRow } from "./decision-store.js";
import { moRowToLoopRow, type LoopRow } from "./loop-store.js";
import { moRowToInvariantRow, type InvariantRow } from "./invariant-store.js";

export interface StateSnapshot {
  timestamp: string;
  scopeId: number;
  claims: ClaimRow[];
  decisions: DecisionRow[];
  openLoops: LoopRow[];
  invariants: InvariantRow[];
  evidenceCount: number;
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Get a frozen view of the evidence state at a point in time.
 *
 * For each object kind, queries items that existed at the timestamp
 * and were not yet superseded/closed/discarded at that time.
 */
export function getStateAtTime(
  db: GraphDb,
  scopeId: number,
  timestamp: string,
): StateSnapshot {
  // Claims active at timestamp: created before T, and either:
  // - still active now, OR
  // - status changed AFTER T (was still active at T)
  const claims = (db.prepare(`
    SELECT * FROM memory_objects
    WHERE scope_id = ? AND kind = 'claim' AND created_at <= ?
      AND (status = 'active' OR (status IN ('superseded', 'retracted') AND updated_at > ?))
    ORDER BY confidence DESC
    LIMIT 50
  `).all(scopeId, timestamp, timestamp) as Record<string, unknown>[]).map(moRowToClaimRow);

  // Decisions active at timestamp: created before T, and either still active
  // or superseded by a decision created AFTER T
  const decisions = (db.prepare(`
    SELECT * FROM memory_objects
    WHERE scope_id = ? AND kind = 'decision' AND created_at <= ?
      AND (status = 'active'
           OR (superseded_by IS NOT NULL
               AND (SELECT created_at FROM memory_objects WHERE id = memory_objects.superseded_by) > ?))
    ORDER BY created_at DESC
    LIMIT 50
  `).all(scopeId, timestamp, timestamp) as Record<string, unknown>[]).map(moRowToDecisionRow);

  // Loops that were open at timestamp
  const openLoops = (db.prepare(`
    SELECT * FROM memory_objects
    WHERE scope_id = ? AND kind = 'loop' AND created_at <= ?
      AND (status = 'active' OR (status IN ('superseded', 'retracted') AND updated_at > ?))
    ORDER BY COALESCE(json_extract(structured_json, '$.priority'), 0) DESC
    LIMIT 50
  `).all(scopeId, timestamp, timestamp) as Record<string, unknown>[]).map(moRowToLoopRow);

  // Invariants active at timestamp: exclude retracted regardless of updated_at
  const invariants = (db.prepare(`
    SELECT * FROM memory_objects
    WHERE scope_id = ? AND kind = 'invariant' AND created_at <= ?
      AND (status = 'active'
           OR (status = 'superseded' AND updated_at > ?))
    ORDER BY CASE json_extract(structured_json, '$.severity')
      WHEN 'critical' THEN 0 WHEN 'error' THEN 1 WHEN 'warning' THEN 2 WHEN 'info' THEN 3 ELSE 4
    END ASC
    LIMIT 50
  `).all(scopeId, timestamp, timestamp) as Record<string, unknown>[]).map(moRowToInvariantRow);

  // Evidence count up to timestamp
  const countRow = db.prepare(`
    SELECT COUNT(*) AS cnt FROM evidence_log
    WHERE (scope_id = ? OR scope_id IS NULL) AND created_at <= ?
  `).get(scopeId, timestamp) as { cnt: number };

  return {
    timestamp,
    scopeId,
    claims,
    decisions,
    openLoops,
    invariants,
    evidenceCount: countRow.cnt,
  };
}

/**
 * Get evidence log entries up to a timestamp.
 */
export function getEvidenceAtTime(
  db: GraphDb,
  scopeId: number,
  timestamp: string,
  limit = 50,
): Array<{
  id: number;
  object_type: string;
  object_id: number;
  event_type: string;
  actor: string | null;
  created_at: string;
}> {
  return db.prepare(`
    SELECT id, object_type, object_id, event_type, actor, created_at
    FROM evidence_log
    WHERE (scope_id = ? OR scope_id IS NULL) AND created_at <= ?
    ORDER BY created_at DESC, id DESC
    LIMIT ?
  `).all(scopeId, timestamp, limit) as Array<{
    id: number;
    object_type: string;
    object_id: number;
    event_type: string;
    actor: string | null;
    created_at: string;
  }>;
}
