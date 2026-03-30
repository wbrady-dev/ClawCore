/**
 * Lease store — advisory coordination for multi-agent resource access.
 *
 * Leases are best-effort hints, not hard locks. If an agent crashes,
 * its leases expire naturally via lease_until timestamps.
 */

import type { GraphDb } from "./types.js";
import { logEvidence, withWriteTransaction } from "./evidence-log.js";

export interface AcquireLeaseInput {
  scopeId: number;
  agentId: string;
  resourceKey: string;
  durationMs: number;
}

export interface LeaseRow {
  id: number;
  scope_id: number;
  agent_id: string;
  resource_key: string;
  lease_until: string;
  acquired_at: string;
}

/**
 * Attempt to acquire a lease on a resource. Advisory, not a hard lock.
 * If the resource is already leased and the lease hasn't expired,
 * returns null (lease held by another agent). If expired, takes over.
 */
export function acquireLease(
  db: GraphDb,
  input: AcquireLeaseInput,
): LeaseRow | null {
  if (input.durationMs <= 0) return null;
  const leaseUntil = new Date(Date.now() + input.durationMs).toISOString();

  // Atomic: BEGIN IMMEDIATE prevents concurrent writers between delete and insert
  return withWriteTransaction(db, () => {
    // Clean expired leases for this resource
    db.prepare(
      "DELETE FROM work_leases WHERE scope_id = ? AND resource_key = ? AND lease_until < strftime('%Y-%m-%dT%H:%M:%f', 'now')",
    ).run(input.scopeId, input.resourceKey);

    // Try to insert (will fail if active lease exists due to UNIQUE constraint)
    try {
      db.prepare(`
        INSERT INTO work_leases (scope_id, agent_id, resource_key, lease_until)
        VALUES (?, ?, ?, ?)
      `).run(input.scopeId, input.agentId, input.resourceKey, leaseUntil);
    } catch {
      // UNIQUE constraint violation — lease held by another agent
      return null;
    }

    const row = db.prepare(
      "SELECT * FROM work_leases WHERE scope_id = ? AND resource_key = ?",
    ).get(input.scopeId, input.resourceKey) as LeaseRow | undefined;

    if (row) {
      logEvidence(db, {
        scopeId: input.scopeId,
        objectType: "lease",
        objectId: row.id,
        eventType: "acquire",
        actor: input.agentId,
        payload: { resourceKey: input.resourceKey, leaseUntil },
      });
    }

    return row ?? null;
  });
}

/** Renew an existing lease by extending its duration. Only the owning agent can renew. */
export function renewLease(db: GraphDb, leaseId: number, durationMs: number, agentId: string): { renewed: boolean } {
  const leaseUntil = new Date(Date.now() + durationMs).toISOString();

  const leaseRow = db.prepare(
    "SELECT scope_id FROM work_leases WHERE id = ? AND agent_id = ?",
  ).get(leaseId, agentId) as { scope_id: number } | undefined;

  if (!leaseRow) {
    return { renewed: false };
  }

  db.prepare(
    "UPDATE work_leases SET lease_until = ? WHERE id = ? AND agent_id = ?",
  ).run(leaseUntil, leaseId, agentId);

  logEvidence(db, {
    scopeId: leaseRow.scope_id,
    objectType: "lease",
    objectId: leaseId,
    eventType: "renew",
    actor: agentId,
    payload: { leaseUntil },
  });

  return { renewed: true };
}

/** Release a lease (explicit cleanup). Only the owning agent can release. */
export function releaseLease(db: GraphDb, leaseId: number, agentId: string): { released: boolean } {
  const leaseRow = db.prepare(
    "SELECT scope_id FROM work_leases WHERE id = ? AND agent_id = ?",
  ).get(leaseId, agentId) as { scope_id: number } | undefined;

  if (!leaseRow) {
    return { released: false };
  }

  const result = db.prepare("DELETE FROM work_leases WHERE id = ? AND agent_id = ?").run(leaseId, agentId);

  if (Number(result.changes) === 0) {
    return { released: false };
  }

  logEvidence(db, {
    scopeId: leaseRow.scope_id,
    objectType: "lease",
    objectId: leaseId,
    eventType: "release",
    actor: agentId,
  });

  return { released: true };
}

/** Get active (non-expired) leases for a scope, optionally filtered by agent. */
export function getActiveLeases(
  db: GraphDb,
  scopeId: number,
  agentId?: string,
): LeaseRow[] {
  if (agentId) {
    return db.prepare(`
      SELECT * FROM work_leases
      WHERE scope_id = ? AND agent_id = ? AND lease_until > strftime('%Y-%m-%dT%H:%M:%f', 'now')
      ORDER BY acquired_at DESC
    `).all(scopeId, agentId) as LeaseRow[];
  }
  return db.prepare(`
    SELECT * FROM work_leases
    WHERE scope_id = ? AND lease_until > strftime('%Y-%m-%dT%H:%M:%f', 'now')
    ORDER BY acquired_at DESC
  `).all(scopeId) as LeaseRow[];
}

/** Clean up all expired leases. Called lazily. */
export function cleanExpiredLeases(db: GraphDb): number {
  const result = db.prepare(
    "DELETE FROM work_leases WHERE lease_until < strftime('%Y-%m-%dT%H:%M:%f', 'now')",
  ).run();
  return Number(result.changes);
}
