/**
 * Capability store — tracking available tools, systems, and services.
 *
 * Phase 3: All writes delegate to mo-store.ts (memory_objects table).
 * Reads query memory_objects directly. Legacy table writes removed.
 *
 * Function signatures are UNCHANGED — callers don't need to change.
 */

import type { GraphDb, UpsertCapabilityInput } from "./types.js";
import { logEvidence } from "./evidence-log.js";
import { upsertMemoryObject } from "../ontology/mo-store.js";
import type { MemoryObject } from "../ontology/types.js";
import { safeParseStructured } from "../ontology/json-utils.js";

export function upsertCapability(
  db: GraphDb,
  input: UpsertCapabilityInput,
): { capabilityId: number; isNew: boolean } {
  const compositeId = `capability:${input.scopeId}:${input.capabilityType}:${input.capabilityKey}`;

  const mo: MemoryObject = {
    id: compositeId,
    kind: "capability",
    content: input.summary ?? `${input.capabilityType}/${input.capabilityKey}`,
    structured: {
      capabilityType: input.capabilityType,
      capabilityKey: input.capabilityKey,
      displayName: input.displayName ?? null,
      status: input.status ?? "available",
      summary: input.summary ?? null,
      metadata: input.metadataJson ? tryParseJson(input.metadataJson) : null,
    },
    canonical_key: `cap::${input.capabilityType}::${input.capabilityKey}`,
    provenance: {
      source_kind: "extraction",
      source_id: "",
      actor: "system",
      trust: 0.5,
    },
    confidence: 0.5,
    freshness: 1.0,
    provisional: false,
    status: "active",
    observed_at: new Date().toISOString(),
    scope_id: input.scopeId,
    influence_weight: "standard",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const result = upsertMemoryObject(db, mo);

  logEvidence(db, {
    scopeId: input.scopeId,
    objectType: "capability",
    objectId: result.moId,
    eventType: result.isNew ? "create" : "update",
  });

  return { capabilityId: result.moId, isNew: result.isNew };
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

function moRowToCapabilityRow(row: Record<string, unknown>): CapabilityRow {
  let structured: Record<string, unknown> = {};
  if (row.structured_json != null && typeof row.structured_json === "string") {
    structured = safeParseStructured(row.structured_json);
  }
  return {
    id: Number(row.id),
    scope_id: Number(row.scope_id ?? 1),
    capability_type: String(structured.capabilityType ?? ""),
    capability_key: String(structured.capabilityKey ?? ""),
    display_name: structured.displayName != null ? String(structured.displayName) : null,
    status: String(structured.status ?? "available"),
    summary: structured.summary != null ? String(structured.summary) : null,
    metadata_json: structured.metadata != null ? JSON.stringify(structured.metadata) : null,
    last_checked_at: String(row.updated_at ?? ""),
  };
}

export function getCapabilities(
  db: GraphDb,
  scopeId: number,
  opts?: { type?: string; status?: string; limit?: number },
): CapabilityRow[] {
  const limit = opts?.limit ?? 50;
  const where = ["scope_id = ?", "kind = 'capability'"];
  const args: unknown[] = [scopeId];

  if (opts?.type) {
    where.push("json_extract(structured_json, '$.capabilityType') = ?");
    args.push(opts.type);
  }
  if (opts?.status) {
    where.push("json_extract(structured_json, '$.status') = ?");
    args.push(opts.status);
  }

  args.push(limit);
  return (db.prepare(`
    SELECT * FROM memory_objects
    WHERE ${where.join(" AND ")}
    ORDER BY json_extract(structured_json, '$.capabilityType'),
             json_extract(structured_json, '$.capabilityKey')
    LIMIT ?
  `).all(...args) as Record<string, unknown>[]).map(moRowToCapabilityRow);
}

function tryParseJson(s: string): unknown {
  try { return JSON.parse(s); } catch { return s; }
}
