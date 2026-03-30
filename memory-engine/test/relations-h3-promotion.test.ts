import { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it } from "vitest";
import { runGraphMigrations } from "../src/relations/schema.js";
import { acquireLease, renewLease, releaseLease, getActiveLeases, cleanExpiredLeases } from "../src/relations/lease-store.js";
import { checkPromotionPolicy, createBranch, promoteBranch, discardBranch, getBranches } from "../src/relations/promotion.js";
import type { GraphDb } from "../src/relations/types.js";

function createDb(): GraphDb {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  runGraphMigrations(db as unknown as GraphDb);
  return db as unknown as GraphDb;
}

// ============================================================================
// Schema
// ============================================================================

describe("H3 Schema v4", () => {
  it("creates work_leases table", () => {
    const db = createDb();
    const tables = (db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
    ).all() as Array<{ name: string }>).map((r) => r.name);
    expect(tables).toContain("work_leases");
  });

  it("migration v4 is idempotent", () => {
    const db = createDb();
    runGraphMigrations(db);
    const v4 = db.prepare("SELECT version FROM _evidence_migrations WHERE version = 4").get();
    expect(v4).toBeDefined();
  });
});

// ============================================================================
// Lease Store
// ============================================================================

describe("H3 Lease Store", () => {
  let db: GraphDb;
  beforeEach(() => { db = createDb(); });

  it("acquireLease creates a lease", () => {
    const lease = acquireLease(db, {
      scopeId: 1, agentId: "agent-1", resourceKey: "file:main.ts", durationMs: 60_000,
    });
    expect(lease).not.toBeNull();
    expect(lease!.agent_id).toBe("agent-1");
    expect(lease!.resource_key).toBe("file:main.ts");
  });

  it("acquireLease fails if resource already leased", () => {
    acquireLease(db, {
      scopeId: 1, agentId: "agent-1", resourceKey: "file:main.ts", durationMs: 60_000,
    });
    const second = acquireLease(db, {
      scopeId: 1, agentId: "agent-2", resourceKey: "file:main.ts", durationMs: 60_000,
    });
    expect(second).toBeNull();
  });

  it("acquireLease takes over expired leases", () => {
    // Insert an expired lease directly
    db.prepare(`
      INSERT INTO work_leases (scope_id, agent_id, resource_key, lease_until)
      VALUES (1, 'agent-old', 'file:main.ts', datetime('now', '-1 hour'))
    `).run();

    const lease = acquireLease(db, {
      scopeId: 1, agentId: "agent-new", resourceKey: "file:main.ts", durationMs: 60_000,
    });
    expect(lease).not.toBeNull();
    expect(lease!.agent_id).toBe("agent-new");
  });

  it("releaseLease removes the lease", () => {
    const lease = acquireLease(db, {
      scopeId: 1, agentId: "agent-1", resourceKey: "file:main.ts", durationMs: 60_000,
    });
    releaseLease(db, lease!.id, "agent-1");
    const active = getActiveLeases(db, 1);
    expect(active.length).toBe(0);
  });

  it("getActiveLeases filters by agent", () => {
    acquireLease(db, { scopeId: 1, agentId: "agent-1", resourceKey: "file:a.ts", durationMs: 60_000 });
    acquireLease(db, { scopeId: 1, agentId: "agent-2", resourceKey: "file:b.ts", durationMs: 60_000 });

    const agent1 = getActiveLeases(db, 1, "agent-1");
    expect(agent1.length).toBe(1);
    expect(agent1[0].resource_key).toBe("file:a.ts");
  });

  it("cleanExpiredLeases removes old leases", () => {
    db.prepare(`
      INSERT INTO work_leases (scope_id, agent_id, resource_key, lease_until)
      VALUES (1, 'agent-old', 'file:old.ts', datetime('now', '-1 hour'))
    `).run();
    acquireLease(db, { scopeId: 1, agentId: "agent-new", resourceKey: "file:new.ts", durationMs: 60_000 });

    const cleaned = cleanExpiredLeases(db);
    expect(cleaned).toBe(1);

    const all = getActiveLeases(db, 1);
    expect(all.length).toBe(1);
    expect(all[0].resource_key).toBe("file:new.ts");
  });
});

// ============================================================================
// Promotion Engine
// ============================================================================

describe("H3 Promotion Policy", () => {
  let db: GraphDb;
  beforeEach(() => { db = createDb(); });

  it("checkPromotionPolicy allows entity promotion at low confidence", () => {
    const result = checkPromotionPolicy(db, "entity", 0.3, 1);
    expect(result.canPromote).toBe(true);
  });

  it("checkPromotionPolicy rejects claim with low confidence", () => {
    const result = checkPromotionPolicy(db, "claim", 0.4, 2);
    expect(result.canPromote).toBe(false);
    expect(result.reason).toContain("below minimum");
  });

  it("checkPromotionPolicy rejects claim with insufficient evidence", () => {
    const result = checkPromotionPolicy(db, "claim", 0.7, 1); // needs 2
    expect(result.canPromote).toBe(false);
    expect(result.reason).toContain("below required");
  });

  it("checkPromotionPolicy allows claim with sufficient confidence and evidence", () => {
    const result = checkPromotionPolicy(db, "claim", 0.7, 2);
    expect(result.canPromote).toBe(true);
  });

  it("checkPromotionPolicy requires user confirm for decisions", () => {
    const result = checkPromotionPolicy(db, "decision", 0.6, 1, false);
    expect(result.canPromote).toBe(false);
    expect(result.reason).toContain("User confirmation required");
  });

  it("checkPromotionPolicy auto-promotes decision at high confidence", () => {
    const result = checkPromotionPolicy(db, "decision", 0.8, 1, false);
    expect(result.canPromote).toBe(true);
    expect(result.reason).toContain("Auto-promoted");
  });

  it("checkPromotionPolicy allows decision with user confirmation", () => {
    const result = checkPromotionPolicy(db, "decision", 0.6, 1, true);
    expect(result.canPromote).toBe(true);
  });

  it("checkPromotionPolicy returns error for unknown type", () => {
    const result = checkPromotionPolicy(db, "nonexistent", 0.9, 5);
    expect(result.canPromote).toBe(false);
    expect(result.reason).toContain("No promotion policy");
  });
});

describe("H3 Branch Lifecycle", () => {
  let db: GraphDb;
  beforeEach(() => { db = createDb(); });

  it("createBranch creates and returns branch", () => {
    const branch = createBranch(db, 1, "hypothesis", "test-branch", "agent-1");
    expect(branch.id).toBeGreaterThan(0);
    expect(branch.status).toBe("active");
    expect(branch.branch_type).toBe("hypothesis");
  });

  it("promoteBranch updates status to promoted", () => {
    const branch = createBranch(db, 1, "run", "test-run");
    promoteBranch(db, branch.id, "agent-1");

    const branches = getBranches(db, 1, "promoted");
    expect(branches.length).toBe(1);
    expect(branches[0].promoted_at).not.toBeNull();
  });

  it("discardBranch updates status to discarded", () => {
    const branch = createBranch(db, 1, "hypothesis", "bad-idea");
    discardBranch(db, branch.id);

    const active = getBranches(db, 1, "active");
    expect(active.length).toBe(0);

    const discarded = getBranches(db, 1, "discarded");
    expect(discarded.length).toBe(1);
  });

  it("getBranches returns all when no status filter", () => {
    createBranch(db, 1, "hypothesis", "a");
    createBranch(db, 1, "run", "b");
    const branch = createBranch(db, 1, "hypothesis", "c");
    discardBranch(db, branch.id);

    const all = getBranches(db, 1);
    expect(all.length).toBe(3);
  });

  it("evidence log records branch lifecycle events", () => {
    const branch = createBranch(db, 1, "test", "lifecycle");
    promoteBranch(db, branch.id);

    const events = db.prepare(
      "SELECT event_type FROM evidence_log WHERE object_type = 'branch' ORDER BY id",
    ).all() as Array<{ event_type: string }>;
    expect(events.length).toBe(2);
    expect(events[0].event_type).toBe("create");
    expect(events[1].event_type).toBe("promote");
  });
});

// ============================================================================
// Audit-driven additional tests
// ============================================================================

describe("H3 Lease: renewLease", () => {
  it("extends lease duration", () => {
    const db = createDb();
    const lease = acquireLease(db, {
      scopeId: 1, agentId: "agent-1", resourceKey: "res-1", durationMs: 1000,
    });
    expect(lease).not.toBeNull();

    const oldUntil = lease!.lease_until;
    renewLease(db, lease!.id, 600_000, "agent-1"); // extend by 10 minutes

    const renewed = db.prepare("SELECT lease_until FROM work_leases WHERE id = ?").get(lease!.id) as { lease_until: string };
    expect(new Date(renewed.lease_until).getTime()).toBeGreaterThan(new Date(oldUntil).getTime());
  });
});

describe("H3 Lease: same agent multiple resources", () => {
  it("same agent can hold leases on different resources", () => {
    const db = createDb();
    const a = acquireLease(db, { scopeId: 1, agentId: "agent-1", resourceKey: "file:a.ts", durationMs: 60_000 });
    const b = acquireLease(db, { scopeId: 1, agentId: "agent-1", resourceKey: "file:b.ts", durationMs: 60_000 });
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    const leases = getActiveLeases(db, 1, "agent-1");
    expect(leases.length).toBe(2);
  });
});

describe("H3 Promotion: invariant and attempt types", () => {
  it("invariant requires user confirm or auto-promotes at 0.9+", () => {
    const db = createDb();
    // Below auto-promote threshold, no user confirm
    const denied = checkPromotionPolicy(db, "invariant", 0.8, 1, false);
    expect(denied.canPromote).toBe(false);

    // At auto-promote threshold
    const auto = checkPromotionPolicy(db, "invariant", 0.95, 1, false);
    expect(auto.canPromote).toBe(true);
    expect(auto.reason).toContain("Auto-promoted");

    // Below threshold but user confirmed
    const confirmed = checkPromotionPolicy(db, "invariant", 0.8, 1, true);
    expect(confirmed.canPromote).toBe(true);
  });

  it("attempt always promotes (min_confidence=0.0)", () => {
    const db = createDb();
    const result = checkPromotionPolicy(db, "attempt", 0.0, 1);
    expect(result.canPromote).toBe(true);
  });
});
