/**
 * Snapshot queries — point-in-time state inspection.
 *
 * Phase 3: Queries memory_objects with timestamp filters to reconstruct
 * what the state looked like at a given moment. Uses status + updated_at
 * to determine which items were still active at a timestamp.
 */

import type { GraphDb } from "./types.js";
import type { ClaimRow } from "./claim-store.js";
import type { DecisionRow } from "./decision-store.js";
import type { LoopRow } from "./loop-store.js";
import type { InvariantRow } from "./invariant-store.js";

export interface StateSnapshot {
  timestamp: string;
  scopeId: number;
  claims: ClaimRow[];
  decisions: DecisionRow[];
  openLoops: LoopRow[];
  invariants: InvariantRow[];
  evidenceCount: number;
}

// ── Row adapters ────────────────────────────────────────────────────────────
// Convert memory_objects rows to legacy Row types for backward compatibility.

function moRowToClaimRow(row: Record<string, unknown>): ClaimRow {
  let structured: Record<string, unknown> = {};
  if (row.structured_json != null && typeof row.structured_json === "string") {
    try { structured = JSON.parse(row.structured_json as string); } catch { /* empty */ }
  }
  return {
    id: Number(row.id),
    scope_id: Number(row.scope_id ?? 1),
    branch_id: Number(row.branch_id ?? 0),
    subject: String(structured.subject ?? ""),
    predicate: String(structured.predicate ?? ""),
    object_text: structured.objectText != null ? String(structured.objectText) : null,
    object_json: structured.objectJson != null ? String(structured.objectJson) : null,
    value_type: String(structured.valueType ?? "text"),
    status: String(row.status ?? "active"),
    confidence: Number(row.confidence ?? 0.5),
    trust_score: Number(row.trust_score ?? 0.5),
    source_authority: Number(row.source_authority ?? 0.5),
    canonical_key: String(row.canonical_key ?? ""),
    first_seen_at: String(row.first_observed_at ?? row.created_at ?? ""),
    last_seen_at: String(row.last_observed_at ?? row.updated_at ?? ""),
  };
}

function moRowToDecisionRow(row: Record<string, unknown>): DecisionRow {
  let structured: Record<string, unknown> = {};
  if (row.structured_json != null && typeof row.structured_json === "string") {
    try { structured = JSON.parse(row.structured_json as string); } catch { /* empty */ }
  }
  return {
    id: Number(row.id),
    scope_id: Number(row.scope_id ?? 1),
    branch_id: Number(row.branch_id ?? 0),
    topic: String(structured.topic ?? ""),
    decision_text: String(structured.decisionText ?? row.content ?? ""),
    status: String(row.status ?? "active"),
    decided_at: String(row.created_at ?? ""),
    superseded_by: row.superseded_by != null ? Number(row.superseded_by) : null,
    source_type: row.source_kind != null ? String(row.source_kind) : null,
    source_id: row.source_id != null ? String(row.source_id) : null,
    source_detail: row.source_detail != null ? String(row.source_detail) : null,
  };
}

function moRowToLoopRow(row: Record<string, unknown>): LoopRow {
  let structured: Record<string, unknown> = {};
  if (row.structured_json != null && typeof row.structured_json === "string") {
    try { structured = JSON.parse(row.structured_json as string); } catch { /* empty */ }
  }
  return {
    id: Number(row.id),
    scope_id: Number(row.scope_id ?? 1),
    branch_id: Number(row.branch_id ?? 0),
    loop_type: String(structured.loopType ?? "task"),
    text: String(structured.text ?? row.content ?? ""),
    status: String(row.status ?? "active"),
    priority: Number(structured.priority ?? 0),
    owner: structured.owner != null ? String(structured.owner) : null,
    due_at: structured.dueAt != null ? String(structured.dueAt) : null,
    waiting_on: structured.waitingOn != null ? String(structured.waitingOn) : null,
    opened_at: String(row.created_at ?? ""),
    closed_at: row.status === "superseded" ? String(row.updated_at ?? "") : null,
  };
}

function moRowToInvariantRow(row: Record<string, unknown>): InvariantRow {
  let structured: Record<string, unknown> = {};
  if (row.structured_json != null && typeof row.structured_json === "string") {
    try { structured = JSON.parse(row.structured_json as string); } catch { /* empty */ }
  }
  return {
    id: Number(row.id),
    scope_id: Number(row.scope_id ?? 1),
    invariant_key: String(structured.key ?? ""),
    category: structured.category != null ? String(structured.category) : null,
    description: String(row.content ?? ""),
    severity: String(structured.severity ?? "warning"),
    enforcement_mode: String(structured.enforcementMode ?? "warn"),
    status: String(row.status ?? "active"),
    created_at: String(row.created_at ?? ""),
    updated_at: String(row.updated_at ?? ""),
  };
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
      AND (status = 'active' OR updated_at > ?)
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
      AND (status = 'active' OR updated_at > ?)
    ORDER BY COALESCE(json_extract(structured_json, '$.priority'), 0) DESC
    LIMIT 50
  `).all(scopeId, timestamp, timestamp) as Record<string, unknown>[]).map(moRowToLoopRow);

  // Invariants active at timestamp: exclude retracted regardless of updated_at
  const invariants = (db.prepare(`
    SELECT * FROM memory_objects
    WHERE scope_id = ? AND kind = 'invariant' AND created_at <= ?
      AND (status = 'active'
           OR (status != 'retracted' AND updated_at > ?))
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
