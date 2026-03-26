/**
 * Open loop store — tracking tasks, questions, and dependencies.
 *
 * Phase 3: All writes delegate to mo-store.ts (memory_objects table).
 * Reads query memory_objects directly. Legacy table writes removed.
 *
 * Function signatures are UNCHANGED — callers don't need to change.
 */

import type { GraphDb, OpenLoopInput, UpdateLoopInput } from "./types.js";
import { logEvidence } from "./evidence-log.js";
import { upsertMemoryObject, updateMemoryObjectStatus } from "../ontology/mo-store.js";
import type { MemoryObject } from "../ontology/types.js";
import { safeParseStructured } from "../ontology/json-utils.js";

// ---------------------------------------------------------------------------
// Open
// ---------------------------------------------------------------------------

export function openLoop(db: GraphDb, input: OpenLoopInput): number {
  const branchId = input.branchId ?? 0;
  const now = new Date().toISOString();
  const compositeId = `loop:${input.scopeId}:${branchId}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;

  const mo: MemoryObject = {
    id: compositeId,
    kind: "loop",
    content: input.text,
    structured: {
      loopType: input.loopType ?? "task",
      text: input.text,
      priority: input.priority ?? 0,
      owner: input.owner ?? null,
      dueAt: input.dueAt ?? null,
      waitingOn: input.waitingOn ?? null,
    },
    provenance: {
      source_kind: "extraction",
      source_id: input.sourceId ?? "",
      source_detail: input.sourceDetail ?? undefined,
      actor: "system",
      trust: 0.5,
    },
    confidence: 0.5,
    freshness: 1.0,
    provisional: false,
    status: "active",
    observed_at: now,
    scope_id: input.scopeId,
    influence_weight: "standard",
    created_at: now,
    updated_at: now,
  };

  const result = upsertMemoryObject(db, mo);

  logEvidence(db, {
    scopeId: input.scopeId,
    branchId: branchId || undefined,
    objectType: "open_loop",
    objectId: result.moId,
    eventType: "open",
  });

  return result.moId;
}

// ---------------------------------------------------------------------------
// Close
// ---------------------------------------------------------------------------

export function closeLoop(db: GraphDb, loopId: number): void {
  const loop = db.prepare("SELECT composite_id, scope_id, branch_id FROM memory_objects WHERE id = ? AND kind = 'loop'").get(loopId) as { composite_id: string; scope_id: number; branch_id: number | null } | undefined;

  if (loop) {
    updateMemoryObjectStatus(db, loop.composite_id, "superseded");
  }

  logEvidence(db, {
    scopeId: loop?.scope_id,
    branchId: loop?.branch_id ?? undefined,
    objectType: "open_loop",
    objectId: loopId,
    eventType: "close",
  });
}

// ---------------------------------------------------------------------------
// Update
// ---------------------------------------------------------------------------

export function updateLoop(db: GraphDb, input: UpdateLoopInput): void {
  const loop = db.prepare("SELECT composite_id, scope_id, branch_id, structured_json FROM memory_objects WHERE id = ? AND kind = 'loop'").get(input.loopId) as { composite_id: string; scope_id: number; branch_id: number | null; structured_json: string | null } | undefined;
  if (!loop) return;

  let structured: Record<string, unknown> = {};
  if (loop.structured_json) {
    structured = safeParseStructured(loop.structured_json);
  }

  // Apply updates to structured data
  if (input.priority != null) structured.priority = input.priority;
  if (input.waitingOn !== undefined) structured.waitingOn = input.waitingOn;
  // Store the loop-specific status in structured data (open, blocked, closed, stale)
  if (input.status != null) structured.loopStatus = input.status;

  const sets: string[] = ["structured_json = ?", "updated_at = strftime('%Y-%m-%dT%H:%M:%f', 'now')"];
  const args: unknown[] = [JSON.stringify(structured)];

  if (input.status != null) {
    // Map loop status to memory_objects status
    // Only "closed" maps to "superseded"; everything else stays "active" in memory_objects
    const moStatus = input.status === "closed" ? "superseded" : "active";
    sets.push("status = ?");
    args.push(moStatus);
  }

  args.push(loop.composite_id);
  db.prepare(`UPDATE memory_objects SET ${sets.join(", ")} WHERE composite_id = ?`).run(...args);

  logEvidence(db, {
    scopeId: loop.scope_id,
    branchId: loop.branch_id ?? undefined,
    objectType: "open_loop",
    objectId: input.loopId,
    eventType: "update",
    payload: { status: input.status, priority: input.priority },
  });
}

// ---------------------------------------------------------------------------
// Query
// ---------------------------------------------------------------------------

export interface LoopRow {
  id: number;
  scope_id: number;
  branch_id: number;
  loop_type: string;
  text: string;
  status: string;
  priority: number;
  owner: string | null;
  due_at: string | null;
  waiting_on: string | null;
  opened_at: string;
  closed_at: string | null;
}

export function moRowToLoopRow(row: Record<string, unknown>): LoopRow {
  let structured: Record<string, unknown> = {};
  if (row.structured_json != null && typeof row.structured_json === "string") {
    structured = safeParseStructured(row.structured_json);
  }

  // Use loop-specific status from structured_json if available; otherwise map from memory_objects status
  const moStatus = String(row.status ?? "active");
  const loopStatus = structured.loopStatus != null
    ? String(structured.loopStatus)
    : moStatus === "active" ? "open" : moStatus === "superseded" ? "closed" : moStatus;

  return {
    id: Number(row.id),
    scope_id: Number(row.scope_id ?? 1),
    branch_id: Number(row.branch_id ?? 0),
    loop_type: String(structured.loopType ?? "task"),
    text: String(structured.text ?? row.content ?? ""),
    status: loopStatus,
    priority: Number(structured.priority ?? 0),
    owner: structured.owner != null ? String(structured.owner) : null,
    due_at: structured.dueAt != null ? String(structured.dueAt) : null,
    waiting_on: structured.waitingOn != null ? String(structured.waitingOn) : null,
    opened_at: String(row.created_at ?? ""),
    closed_at: moStatus === "superseded" ? String(row.updated_at ?? "") : null,
  };
}

export function getOpenLoops(
  db: GraphDb,
  scopeId: number,
  branchId?: number,
  limit = 50,
  statusFilter?: string,
): LoopRow[] {
  // Map loop statuses to memory_objects statuses
  // open/blocked → active, closed → superseded, stale → stale
  let statusClause: string;
  if (statusFilter === "all") {
    statusClause = "1=1";
  } else if (statusFilter === "closed") {
    statusClause = "status = 'superseded'";
  } else if (statusFilter === "stale") {
    statusClause = "status = 'stale'";
  } else if (statusFilter === "blocked") {
    statusClause = "status = 'active' AND structured_json LIKE '%\"loopStatus\":\"blocked\"%'";
  } else {
    // Default: open + blocked → active
    statusClause = "status = 'active'";
  }

  if (branchId != null) {
    return (db.prepare(`
      SELECT * FROM memory_objects
      WHERE scope_id = ? AND (branch_id = 0 OR branch_id = ?) AND kind = 'loop' AND ${statusClause}
      ORDER BY COALESCE(json_extract(structured_json, '$.priority'), 0) DESC, created_at ASC LIMIT ?
    `).all(scopeId, branchId, limit) as Record<string, unknown>[]).map(moRowToLoopRow);
  }
  return (db.prepare(`
    SELECT * FROM memory_objects
    WHERE scope_id = ? AND branch_id = 0 AND kind = 'loop' AND ${statusClause}
    ORDER BY COALESCE(json_extract(structured_json, '$.priority'), 0) DESC, created_at ASC LIMIT ?
  `).all(scopeId, limit) as Record<string, unknown>[]).map(moRowToLoopRow);
}
