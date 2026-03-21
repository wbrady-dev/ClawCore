/**
 * Attempt store — tool outcome ledger for tracking success/failure rates.
 */

import type { GraphDb, RecordAttemptInput } from "./types.js";
import { logEvidence } from "./evidence-log.js";

export function recordAttempt(db: GraphDb, input: RecordAttemptInput): number {
  const branchId = input.branchId ?? 0;

  const result = db.prepare(`
    INSERT INTO attempts
      (scope_id, branch_id, tool_name, input_summary, output_summary, status, duration_ms, error_text)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    input.scopeId, branchId, input.toolName,
    input.inputSummary ?? null, input.outputSummary ?? null,
    input.status, input.durationMs ?? null, input.errorText ?? null,
  );

  const attemptId = Number(result.lastInsertRowid);

  logEvidence(db, {
    scopeId: input.scopeId,
    branchId: branchId || undefined,
    objectType: "attempt",
    objectId: attemptId,
    eventType: "record",
    payload: { toolName: input.toolName, status: input.status, durationMs: input.durationMs },
  });

  return attemptId;
}

export interface AttemptRow {
  id: number;
  scope_id: number;
  tool_name: string;
  input_summary: string | null;
  output_summary: string | null;
  status: string;
  duration_ms: number | null;
  error_text: string | null;
  created_at: string;
}

export function getAttemptHistory(
  db: GraphDb,
  scopeId: number,
  opts?: { toolName?: string; status?: string; limit?: number },
): AttemptRow[] {
  const limit = opts?.limit ?? 20;
  const where = ["scope_id = ?"];
  const args: unknown[] = [scopeId];

  if (opts?.toolName) {
    where.push("tool_name = ?");
    args.push(opts.toolName);
  }
  if (opts?.status) {
    where.push("status = ?");
    args.push(opts.status);
  }

  args.push(limit);
  return db.prepare(`
    SELECT * FROM attempts
    WHERE ${where.join(" AND ")}
    ORDER BY created_at DESC, id DESC LIMIT ?
  `).all(...args) as AttemptRow[];
}

export interface ToolSuccessRate {
  toolName: string;
  total: number;
  successes: number;
  failures: number;
  rate: number;
}

export function getToolSuccessRate(
  db: GraphDb,
  scopeId: number,
  toolName: string,
  windowDays?: number,
): ToolSuccessRate {
  const where = ["scope_id = ?", "tool_name = ?"];
  const args: unknown[] = [scopeId, toolName];

  if (windowDays != null) {
    where.push("created_at >= datetime('now', ?)");
    args.push(`-${windowDays} days`);
  }

  const row = db.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) AS successes,
      SUM(CASE WHEN status = 'failure' THEN 1 ELSE 0 END) AS failures
    FROM attempts
    WHERE ${where.join(" AND ")}
  `).get(...args) as { total: number; successes: number; failures: number };

  return {
    toolName,
    total: row.total,
    successes: row.successes,
    failures: row.failures,
    rate: row.total > 0 ? row.successes / row.total : 0,
  };
}
