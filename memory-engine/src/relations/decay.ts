/**
 * Evidence decay — lazy confidence reduction for runbooks and anti-runbooks.
 *
 * Called from query functions (getRunbooks, getAntiRunbooks) to apply
 * time-based decay before returning results. No background job needed.
 *
 * Anti-runbooks: If no new failure evidence in decayDays (default 90),
 *   reduce confidence by 0.8×. If confidence < 0.2, mark 'under_review'.
 *
 * Runbooks: If failure_rate > 0.5, demote confidence.
 *   If no usage in 180 days, mark 'stale'.
 */

import type { GraphDb } from "./types.js";
import { logEvidence } from "./evidence-log.js";

/**
 * Apply decay to anti-runbooks that haven't seen new failure evidence recently.
 */
export function decayAntiRunbooks(db: GraphDb, scopeId: number, decayDays = 90): number {
  // Reduce confidence for stale anti-runbooks
  const decayed = db.prepare(`
    UPDATE anti_runbooks
    SET confidence = confidence * 0.8,
        updated_at = strftime('%Y-%m-%dT%H:%M:%f', 'now')
    WHERE scope_id = ?
      AND status = 'active'
      AND confidence > 0.2
      AND updated_at < datetime('now', ?)
  `).run(scopeId, `-${decayDays} days`);

  // Mark very low confidence for review
  const reviewed = db.prepare(`
    UPDATE anti_runbooks
    SET status = 'under_review',
        updated_at = strftime('%Y-%m-%dT%H:%M:%f', 'now')
    WHERE scope_id = ?
      AND confidence <= 0.2
      AND status = 'active'
  `).run(scopeId);

  if (Number(decayed.changes) > 0 || Number(reviewed.changes) > 0) {
    logEvidence(db, {
      scopeId,
      objectType: "anti_runbook",
      objectId: 0,
      eventType: "decay",
      payload: {
        confidenceDecayed: Number(decayed.changes),
        markedUnderReview: Number(reviewed.changes),
      },
    });
  }

  return Number(decayed.changes);
}

/**
 * Apply decay to runbooks with high failure rates or no recent usage.
 */
export function decayRunbooks(db: GraphDb, scopeId: number, staleDays = 180): number {
  // Demote runbooks with failure_rate > 0.5
  const demoted = db.prepare(`
    UPDATE runbooks
    SET confidence = confidence * 0.5,
        updated_at = strftime('%Y-%m-%dT%H:%M:%f', 'now')
    WHERE scope_id = ?
      AND status = 'active'
      AND (success_count + failure_count) > 0
      AND CAST(failure_count AS REAL) / (success_count + failure_count) > 0.5
  `).run(scopeId);

  // Mark stale if no usage in staleDays
  const staled = db.prepare(`
    UPDATE runbooks
    SET status = 'stale',
        updated_at = strftime('%Y-%m-%dT%H:%M:%f', 'now')
    WHERE scope_id = ?
      AND status = 'active'
      AND updated_at < datetime('now', ?)
  `).run(scopeId, `-${staleDays} days`);

  if (Number(demoted.changes) > 0 || Number(staled.changes) > 0) {
    logEvidence(db, {
      scopeId,
      objectType: "runbook",
      objectId: 0,
      eventType: "decay",
      payload: {
        confidenceDemoted: Number(demoted.changes),
        markedStale: Number(staled.changes),
      },
    });
  }

  return Number(demoted.changes);
}

/**
 * Apply all decay rules for a scope. Call lazily before queries.
 */
export function applyDecay(db: GraphDb, scopeId: number, decayDays = 90, staleDays = 180): void {
  try {
    decayAntiRunbooks(db, scopeId, decayDays);
    decayRunbooks(db, scopeId, staleDays);
  } catch {
    // Non-fatal: decay failure should not block queries
  }
}
