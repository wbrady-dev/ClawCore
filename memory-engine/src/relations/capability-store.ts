/**
 * Capability store — tracking available tools, systems, and services.
 */

import type { GraphDb, UpsertCapabilityInput } from "./types.js";
import { logEvidence } from "./evidence-log.js";

export function upsertCapability(
  db: GraphDb,
  input: UpsertCapabilityInput,
): { capabilityId: number; isNew: boolean } {
  const existing = db.prepare(
    "SELECT id FROM capabilities WHERE scope_id = ? AND capability_type = ? AND capability_key = ?",
  ).get(input.scopeId, input.capabilityType, input.capabilityKey) as { id: number } | undefined;

  db.prepare(`
    INSERT INTO capabilities
      (scope_id, capability_type, capability_key, display_name, status, summary, metadata_json)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(scope_id, capability_type, capability_key) DO UPDATE SET
      status = excluded.status,
      display_name = COALESCE(excluded.display_name, capabilities.display_name),
      summary = COALESCE(excluded.summary, capabilities.summary),
      metadata_json = COALESCE(excluded.metadata_json, capabilities.metadata_json),
      last_checked_at = strftime('%Y-%m-%dT%H:%M:%f', 'now')
  `).run(
    input.scopeId, input.capabilityType, input.capabilityKey,
    input.displayName ?? null, input.status ?? "available",
    input.summary ?? null, input.metadataJson ?? null,
  );

  const row = db.prepare(
    "SELECT id FROM capabilities WHERE scope_id = ? AND capability_type = ? AND capability_key = ?",
  ).get(input.scopeId, input.capabilityType, input.capabilityKey) as { id: number } | undefined;

  if (!row) {
    throw new Error(`upsertCapability: not found after UPSERT`);
  }

  const isNew = !existing;

  logEvidence(db, {
    scopeId: input.scopeId,
    objectType: "capability",
    objectId: row.id,
    eventType: isNew ? "create" : "update",
  });

  return { capabilityId: row.id, isNew };
}

export interface CapabilityRow {
  id: number;
  scope_id: number;
  capability_type: string;
  capability_key: string;
  display_name: string | null;
  status: string;
  summary: string | null;
  metadata_json: string | null;
  last_checked_at: string;
}

export function getCapabilities(
  db: GraphDb,
  scopeId: number,
  opts?: { type?: string; status?: string; limit?: number },
): CapabilityRow[] {
  const limit = opts?.limit ?? 50;
  const where = ["scope_id = ?"];
  const args: unknown[] = [scopeId];

  if (opts?.type) {
    where.push("capability_type = ?");
    args.push(opts.type);
  }
  if (opts?.status) {
    where.push("status = ?");
    args.push(opts.status);
  }

  args.push(limit);
  return db.prepare(`
    SELECT * FROM capabilities
    WHERE ${where.join(" AND ")}
    ORDER BY capability_type, capability_key LIMIT ?
  `).all(...args) as CapabilityRow[];
}
