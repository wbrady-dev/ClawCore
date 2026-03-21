/**
 * Decision store — CRUD for decisions with automatic supersession.
 *
 * IMPORTANT: upsertDecision() performs a SELECT-INSERT-UPDATE sequence
 * that must be called inside a write transaction (withWriteTransaction)
 * for atomicity. Without a transaction, concurrent calls could create
 * multiple active decisions for the same topic.
 */

import type { GraphDb, UpsertDecisionInput, UpsertDecisionResult } from "./types.js";
import { logEvidence } from "./evidence-log.js";

// ---------------------------------------------------------------------------
// Upsert (auto-supersede existing active decision on same topic)
// ---------------------------------------------------------------------------

export function upsertDecision(db: GraphDb, input: UpsertDecisionInput): UpsertDecisionResult {
  const branchId = input.branchId ?? 0;
  const topic = input.topic.toLowerCase().trim();

  // Check for existing active decision on same topic
  const existing = db.prepare(`
    SELECT id FROM decisions
    WHERE scope_id = ? AND branch_id = ? AND topic = ? AND status = 'active'
    ORDER BY decided_at DESC LIMIT 1
  `).get(input.scopeId, branchId, topic) as { id: number } | undefined;

  // Insert new decision
  const result = db.prepare(`
    INSERT INTO decisions
      (scope_id, branch_id, topic, decision_text, status, source_type, source_id, source_detail)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    input.scopeId, branchId, topic, input.decisionText,
    input.status ?? "active",
    input.sourceType ?? null, input.sourceId ?? null, input.sourceDetail ?? null,
  );

  const decisionId = Number(result.lastInsertRowid);

  // Auto-supersede the old decision if one existed
  if (existing) {
    supersedeDecision(db, existing.id, decisionId);
  }

  logEvidence(db, {
    scopeId: input.scopeId,
    branchId: branchId || undefined,
    objectType: "decision",
    objectId: decisionId,
    eventType: "create",
    payload: { topic, supersedes: existing?.id },
  });

  return { decisionId, isNew: !existing };
}

// ---------------------------------------------------------------------------
// Supersede
// ---------------------------------------------------------------------------

export function supersedeDecision(db: GraphDb, decisionId: number, supersededBy: number): void {
  const decision = db.prepare("SELECT scope_id, branch_id FROM decisions WHERE id = ?").get(decisionId) as { scope_id: number; branch_id: number | null } | undefined;

  db.prepare(
    "UPDATE decisions SET status = 'superseded', superseded_by = ? WHERE id = ?",
  ).run(supersededBy, decisionId);

  logEvidence(db, {
    scopeId: decision?.scope_id,
    branchId: decision?.branch_id ?? undefined,
    objectType: "decision",
    objectId: decisionId,
    eventType: "supersede",
    payload: { supersededBy },
  });
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export interface DecisionRow {
  id: number;
  scope_id: number;
  branch_id: number;
  topic: string;
  decision_text: string;
  status: string;
  decided_at: string;
  superseded_by: number | null;
  source_type: string | null;
  source_id: string | null;
  source_detail: string | null;
}

export function getActiveDecisions(
  db: GraphDb,
  scopeId: number,
  branchId?: number,
  limit = 50,
): DecisionRow[] {
  if (branchId != null) {
    return db.prepare(`
      SELECT * FROM decisions
      WHERE scope_id = ? AND (branch_id = 0 OR branch_id = ?) AND status = 'active'
      ORDER BY decided_at DESC, id DESC LIMIT ?
    `).all(scopeId, branchId, limit) as DecisionRow[];
  }
  return db.prepare(`
    SELECT * FROM decisions
    WHERE scope_id = ? AND branch_id = 0 AND status = 'active'
    ORDER BY decided_at DESC, id DESC LIMIT ?
  `).all(scopeId, limit) as DecisionRow[];
}

export function getDecisionHistory(
  db: GraphDb,
  scopeId: number,
  topic: string,
  limit = 20,
): DecisionRow[] {
  const topicPattern = `%${topic.toLowerCase().trim()}%`;
  return db.prepare(`
    SELECT * FROM decisions
    WHERE scope_id = ? AND topic LIKE ?
    ORDER BY decided_at DESC, id DESC LIMIT ?
  `).all(scopeId, topicPattern, limit) as DecisionRow[];
}
