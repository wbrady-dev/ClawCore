/**
 * Timeline materialization — query the evidence log as a human-readable
 * event timeline. No new table needed — reads directly from evidence_log.
 */

import type { GraphDb } from "./types.js";

export interface TimelineEvent {
  id: number;
  scope_id: number | null;
  object_type: string;
  object_id: number;
  event_type: string;
  actor: string | null;
  payload_json: string | null;
  created_at: string;
  scope_seq: number | null;
}

export interface TimelineOptions {
  since?: string;
  before?: string;
  objectType?: string;
  actor?: string;
  limit?: number;
}

/**
 * Query the evidence log as an ordered timeline.
 */
export function getTimeline(
  db: GraphDb,
  scopeId: number | null,
  opts?: TimelineOptions,
): TimelineEvent[] {
  const limit = opts?.limit ?? 50;
  const where: string[] = [];
  const args: unknown[] = [];

  if (scopeId != null) {
    where.push("scope_id = ?");
    args.push(scopeId);
  }
  if (opts?.since) {
    where.push("created_at >= ?");
    args.push(opts.since);
  }
  if (opts?.before) {
    where.push("created_at < ?");
    args.push(opts.before);
  }
  if (opts?.objectType) {
    where.push("object_type = ?");
    args.push(opts.objectType);
  }
  if (opts?.actor) {
    where.push("actor = ?");
    args.push(opts.actor);
  }

  const whereClause = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
  args.push(limit);

  return db.prepare(`
    SELECT id, scope_id, object_type, object_id, event_type, actor, payload_json, created_at, scope_seq
    FROM evidence_log
    ${whereClause}
    ORDER BY created_at DESC, id DESC
    LIMIT ?
  `).all(...args) as TimelineEvent[];
}

/**
 * Format a timeline event into a human-readable string.
 */
export function formatTimelineEvent(event: TimelineEvent): string {
  const actor = event.actor ? ` by ${event.actor}` : "";
  const payload = event.payload_json ? ` ${summarizePayload(event.payload_json)}` : "";
  return `[${event.created_at}] ${event.object_type}#${event.object_id} ${event.event_type}${actor}${payload}`;
}

function summarizePayload(json: string): string {
  try {
    const parsed = JSON.parse(json);
    const keys = Object.keys(parsed).slice(0, 3);
    return keys.map((k) => `${k}=${JSON.stringify(parsed[k])}`).join(", ");
  } catch {
    return "";
  }
}
