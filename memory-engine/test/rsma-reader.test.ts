/**
 * RSMA MemoryReader Tests — unified read layer validation.
 *
 * Tests that the reader correctly normalizes rows from graph.db
 * into MemoryObjects and ranks them by relevance-to-action.
 */

import { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it } from "vitest";
import { runGraphMigrations } from "../src/relations/schema.js";
import type { GraphDb } from "../src/relations/types.js";
import {
  readMemoryObjects,
  readMemoryObjectById,
  countMemoryObjects,
} from "../src/ontology/reader.js";
import {
  insertProvenanceLink,
  getProvenanceLinksForSubject,
} from "../src/ontology/projector.js";
import { buildCanonicalKey } from "../src/ontology/canonical.js";
import { computeRelevance, TASK_MODE_WEIGHTS } from "../src/ontology/types.js";

let db: GraphDb;

function createDb(): GraphDb {
  const d = new DatabaseSync(":memory:");
  d.exec("PRAGMA journal_mode = WAL");
  d.exec("PRAGMA foreign_keys = ON");
  return d as unknown as GraphDb;
}

function seedClaim(db: GraphDb, overrides: Record<string, unknown> = {}): number {
  const defaults = {
    scope_id: 1, branch_id: 0, subject: "postgres", predicate: "is_used_for",
    object_text: "staging", status: "active", confidence: 0.8,
    trust_score: 0.7, source_authority: 0.7, canonical_key: "claim::postgres::is_used_for",
    first_seen_at: new Date().toISOString(), last_seen_at: new Date().toISOString(),
    created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  };
  const vals = { ...defaults, ...overrides };
  const result = db.prepare(`
    INSERT INTO claims (scope_id, branch_id, subject, predicate, object_text, status, confidence,
      trust_score, source_authority, canonical_key, first_seen_at, last_seen_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    vals.scope_id, vals.branch_id, vals.subject, vals.predicate, vals.object_text,
    vals.status, vals.confidence, vals.trust_score, vals.source_authority,
    vals.canonical_key, vals.first_seen_at, vals.last_seen_at, vals.created_at, vals.updated_at,
  );
  return Number(result.lastInsertRowid);
}

function seedDecision(db: GraphDb, overrides: Record<string, unknown> = {}): number {
  const defaults = {
    scope_id: 1, branch_id: 0, topic: "staging database",
    decision_text: "Use Postgres", status: "active",
    decided_at: new Date().toISOString(), created_at: new Date().toISOString(),
  };
  const vals = { ...defaults, ...overrides };
  const result = db.prepare(`
    INSERT INTO decisions (scope_id, branch_id, topic, decision_text, status, decided_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(vals.scope_id, vals.branch_id, vals.topic, vals.decision_text, vals.status, vals.decided_at, vals.created_at);
  return Number(result.lastInsertRowid);
}

function seedLoop(db: GraphDb, overrides: Record<string, unknown> = {}): number {
  const defaults = {
    scope_id: 1, branch_id: 0, loop_type: "task", text: "Rotate API key",
    status: "open", priority: 5, opened_at: new Date().toISOString(),
  };
  const vals = { ...defaults, ...overrides };
  const result = db.prepare(`
    INSERT INTO open_loops (scope_id, branch_id, loop_type, text, status, priority, opened_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(vals.scope_id, vals.branch_id, vals.loop_type, vals.text, vals.status, vals.priority, vals.opened_at);
  return Number(result.lastInsertRowid);
}

function seedAttempt(db: GraphDb, overrides: Record<string, unknown> = {}): number {
  const defaults = {
    scope_id: 1, branch_id: 0, tool_name: "git_push", status: "success",
    created_at: new Date().toISOString(),
  };
  const vals = { ...defaults, ...overrides };
  const result = db.prepare(`
    INSERT INTO attempts (scope_id, branch_id, tool_name, status, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(vals.scope_id, vals.branch_id, vals.tool_name, vals.status, vals.created_at);
  return Number(result.lastInsertRowid);
}

function seedEntity(db: GraphDb, overrides: Record<string, unknown> = {}): number {
  const defaults = {
    name: "postgres", display_name: "PostgreSQL", entity_type: "technology",
    mention_count: 5, first_seen_at: new Date().toISOString(), last_seen_at: new Date().toISOString(),
  };
  const vals = { ...defaults, ...overrides };
  const result = db.prepare(`
    INSERT INTO entities (name, display_name, entity_type, mention_count, first_seen_at, last_seen_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(vals.name, vals.display_name, vals.entity_type, vals.mention_count, vals.first_seen_at, vals.last_seen_at);
  return Number(result.lastInsertRowid);
}

function seedRunbook(db: GraphDb, overrides: Record<string, unknown> = {}): number {
  const defaults = {
    scope_id: 1, runbook_key: "retry_on_fail", tool_name: "git_push",
    pattern: "Retry with exponential backoff", description: "Works for transient failures",
    success_count: 5, failure_count: 1, confidence: 0.8, status: "active",
    created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  };
  const vals = { ...defaults, ...overrides };
  const result = db.prepare(`
    INSERT INTO runbooks (scope_id, runbook_key, tool_name, pattern, description, success_count, failure_count, confidence, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(vals.scope_id, vals.runbook_key, vals.tool_name, vals.pattern, vals.description, vals.success_count, vals.failure_count, vals.confidence, vals.status, vals.created_at, vals.updated_at);
  return Number(result.lastInsertRowid);
}

function seedAntiRunbook(db: GraphDb, overrides: Record<string, unknown> = {}): number {
  const defaults = {
    scope_id: 1, anti_runbook_key: "force_push_bad", tool_name: "git_push",
    failure_pattern: "Force push to main causes data loss", description: "Never force push to main",
    failure_count: 3, confidence: 0.9, status: "active",
    created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  };
  const vals = { ...defaults, ...overrides };
  const result = db.prepare(`
    INSERT INTO anti_runbooks (scope_id, anti_runbook_key, tool_name, failure_pattern, description, failure_count, confidence, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(vals.scope_id, vals.anti_runbook_key, vals.tool_name, vals.failure_pattern, vals.description, vals.failure_count, vals.confidence, vals.status, vals.created_at, vals.updated_at);
  return Number(result.lastInsertRowid);
}

function seedInvariant(db: GraphDb, overrides: Record<string, unknown> = {}): number {
  const defaults = {
    scope_id: 1, invariant_key: "no_friday_deploys", category: "operations",
    description: "Never deploy on Fridays", severity: "critical",
    enforcement_mode: "warn", status: "active",
    created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  };
  const vals = { ...defaults, ...overrides };
  const result = db.prepare(`
    INSERT INTO invariants (scope_id, invariant_key, category, description, severity, enforcement_mode, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(vals.scope_id, vals.invariant_key, vals.category, vals.description, vals.severity, vals.enforcement_mode, vals.status, vals.created_at, vals.updated_at);
  return Number(result.lastInsertRowid);
}

beforeEach(() => {
  db = createDb();
  runGraphMigrations(db);
});

// ============================================================================
// readMemoryObjects — basic queries
// ============================================================================

describe("RSMA Reader: readMemoryObjects", () => {
  it("returns claims as MemoryObjects", () => {
    seedClaim(db);
    const results = readMemoryObjects(db, { kinds: ["claim"] });
    expect(results.length).toBe(1);
    expect(results[0].kind).toBe("claim");
    expect(results[0].id).toMatch(/^claim:\d+$/);
    expect(results[0].content).toContain("postgres");
    expect(results[0].confidence).toBe(0.8);
    expect(results[0].status).toBe("active");
  });

  it("returns decisions as MemoryObjects", () => {
    seedDecision(db);
    const results = readMemoryObjects(db, { kinds: ["decision"] });
    expect(results.length).toBe(1);
    expect(results[0].kind).toBe("decision");
    expect(results[0].content).toContain("Postgres");
    expect(results[0].influence_weight).toBe("high");
  });

  it("returns entities as MemoryObjects", () => {
    seedEntity(db);
    const results = readMemoryObjects(db, { kinds: ["entity"] });
    expect(results.length).toBe(1);
    expect(results[0].kind).toBe("entity");
    expect(results[0].content).toBe("PostgreSQL");
    expect(results[0].canonical_key).toBe("entity::postgres");
  });

  it("returns loops as MemoryObjects", () => {
    seedLoop(db);
    const results = readMemoryObjects(db, { kinds: ["loop"] });
    expect(results.length).toBe(1);
    expect(results[0].kind).toBe("loop");
    expect(results[0].content).toContain("API key");
  });

  it("returns attempts as MemoryObjects", () => {
    seedAttempt(db);
    const results = readMemoryObjects(db, { kinds: ["attempt"] });
    expect(results.length).toBe(1);
    expect(results[0].kind).toBe("attempt");
    expect(results[0].confidence).toBe(1.0);
  });

  it("returns all kinds when no filter specified", () => {
    seedClaim(db);
    seedDecision(db);
    seedEntity(db);
    seedLoop(db);
    seedAttempt(db);
    const results = readMemoryObjects(db);
    expect(results.length).toBe(5);
    const kinds = results.map((r) => r.kind);
    expect(kinds).toContain("claim");
    expect(kinds).toContain("decision");
    expect(kinds).toContain("entity");
    expect(kinds).toContain("loop");
    expect(kinds).toContain("attempt");
  });

  it("respects status filter", () => {
    seedClaim(db, { status: "active" });
    seedClaim(db, { status: "superseded", canonical_key: "claim::mysql::is_used_for" });
    const active = readMemoryObjects(db, { kinds: ["claim"], statuses: ["active"] });
    expect(active.length).toBe(1);
    const all = readMemoryObjects(db, { kinds: ["claim"], statuses: ["active", "superseded"] });
    expect(all.length).toBe(2);
  });

  it("respects limit", () => {
    for (let i = 0; i < 10; i++) {
      seedClaim(db, { canonical_key: `claim::item${i}::count` });
    }
    const results = readMemoryObjects(db, { kinds: ["claim"], limit: 3 });
    expect(results.length).toBe(3);
  });

  it("filters by keyword", () => {
    seedClaim(db, { object_text: "staging environment" });
    seedClaim(db, { object_text: "production environment", canonical_key: "claim::prod::env" });
    const results = readMemoryObjects(db, { kinds: ["claim"], keyword: "staging" });
    expect(results.length).toBe(1);
    expect(results[0].content).toContain("staging");
  });

  it("handles empty database gracefully", () => {
    const results = readMemoryObjects(db);
    expect(results.length).toBe(0);
  });
});

// ============================================================================
// Ranking
// ============================================================================

describe("RSMA Reader: relevance ranking", () => {
  it("ranks higher-confidence claims above lower", () => {
    seedClaim(db, { confidence: 0.9, canonical_key: "claim::high::conf" });
    seedClaim(db, { confidence: 0.3, canonical_key: "claim::low::conf" });
    const results = readMemoryObjects(db, { kinds: ["claim"] });
    expect(results[0].confidence).toBeGreaterThan(results[1].confidence);
  });

  it("decisions rank above claims in planning mode (higher influence)", () => {
    seedClaim(db);
    seedDecision(db);
    const results = readMemoryObjects(db, { taskMode: "planning" });
    // Decision has influence_weight='high', claim has 'standard'
    // Planning mode: influence weight = 0.25
    const decisionIdx = results.findIndex((r) => r.kind === "decision");
    const claimIdx = results.findIndex((r) => r.kind === "claim");
    expect(decisionIdx).toBeLessThan(claimIdx);
  });

  it("superseded objects are excluded with default status filter", () => {
    seedClaim(db, { status: "superseded", canonical_key: "claim::old::thing" });
    seedClaim(db, { status: "active", canonical_key: "claim::new::thing" });
    const results = readMemoryObjects(db);
    expect(results.length).toBe(1);
    expect(results[0].status).toBe("active");
  });
});

// ============================================================================
// readMemoryObjectById
// ============================================================================

describe("RSMA Reader: readMemoryObjectById", () => {
  it("finds a claim by composite ID", () => {
    const claimId = seedClaim(db);
    const obj = readMemoryObjectById(db, `claim:${claimId}`);
    expect(obj).toBeDefined();
    expect(obj!.kind).toBe("claim");
  });

  it("finds a decision by composite ID", () => {
    const decisionId = seedDecision(db);
    const obj = readMemoryObjectById(db, `decision:${decisionId}`);
    expect(obj).toBeDefined();
    expect(obj!.kind).toBe("decision");
  });

  it("returns undefined for non-existent ID", () => {
    expect(readMemoryObjectById(db, "claim:99999")).toBeUndefined();
  });

  it("returns undefined for invalid composite ID", () => {
    expect(readMemoryObjectById(db, "invalid")).toBeUndefined();
  });

  it("returns undefined for unknown kind", () => {
    expect(readMemoryObjectById(db, "unknown:1")).toBeUndefined();
  });
});

// ============================================================================
// countMemoryObjects
// ============================================================================

describe("RSMA Reader: countMemoryObjects", () => {
  it("counts by kind with status breakdown", () => {
    seedClaim(db, { status: "active" });
    seedClaim(db, { status: "active", canonical_key: "claim::b::c" });
    seedClaim(db, { status: "superseded", canonical_key: "claim::old::val" });
    seedDecision(db);
    seedLoop(db);

    const counts = countMemoryObjects(db);
    expect(counts.claim.total).toBe(3);
    expect(counts.claim.active).toBe(2);
    expect(counts.claim.superseded).toBe(1);
    expect(counts.decision.total).toBe(1);
    expect(counts.decision.active).toBe(1);
    expect(counts.loop.total).toBe(1);
  });

  it("returns zeros for empty database", () => {
    const counts = countMemoryObjects(db);
    for (const kind of Object.keys(counts)) {
      expect(counts[kind].total).toBe(0);
    }
  });

  it("counts procedures including both runbooks and anti-runbooks", () => {
    seedRunbook(db);
    seedRunbook(db, { runbook_key: "retry_v2" });
    seedAntiRunbook(db);
    const counts = countMemoryObjects(db);
    expect(counts.procedure.total).toBe(3); // 2 runbooks + 1 anti-runbook
    expect(counts.procedure.active).toBe(3);
  });
});

// ============================================================================
// Procedures (runbooks + anti-runbooks)
// ============================================================================

describe("RSMA Reader: procedures", () => {
  it("returns runbooks as procedure MemoryObjects", () => {
    seedRunbook(db);
    const results = readMemoryObjects(db, { kinds: ["procedure"] });
    expect(results.length).toBeGreaterThanOrEqual(1);
    const rb = results.find((r) => r.content.includes("[DO]"));
    expect(rb).toBeDefined();
    expect(rb!.kind).toBe("procedure");
    expect(rb!.content).toContain("git_push");
  });

  it("returns anti-runbooks as procedure MemoryObjects", () => {
    seedAntiRunbook(db);
    const results = readMemoryObjects(db, { kinds: ["procedure"] });
    expect(results.length).toBeGreaterThanOrEqual(1);
    const arb = results.find((r) => r.content.includes("[AVOID]"));
    expect(arb).toBeDefined();
    expect(arb!.kind).toBe("procedure");
    expect(arb!.influence_weight).toBe("high"); // anti-runbooks get high influence
  });

  it("returns both runbooks and anti-runbooks together", () => {
    seedRunbook(db);
    seedAntiRunbook(db);
    const results = readMemoryObjects(db, { kinds: ["procedure"] });
    expect(results.length).toBe(2);
    const kinds = results.map((r) => r.content.startsWith("[DO]") ? "runbook" : "anti-runbook");
    expect(kinds).toContain("runbook");
    expect(kinds).toContain("anti-runbook");
  });
});

// ============================================================================
// Invariants
// ============================================================================

describe("RSMA Reader: invariants", () => {
  it("returns invariants as MemoryObjects", () => {
    seedInvariant(db);
    const results = readMemoryObjects(db, { kinds: ["invariant"] });
    expect(results.length).toBe(1);
    expect(results[0].kind).toBe("invariant");
    expect(results[0].content).toContain("Friday");
    expect(results[0].influence_weight).toBe("critical");
  });

  it("invariants with warning severity get high influence", () => {
    seedInvariant(db, { invariant_key: "warn_test", severity: "warning" });
    const results = readMemoryObjects(db, { kinds: ["invariant"] });
    expect(results[0].influence_weight).toBe("high");
  });
});

// ============================================================================
// Integration: projector → reader round-trip
// ============================================================================

describe("RSMA Reader + Projector: integration", () => {
  it("provenance links written by projector are queryable", () => {
    seedClaim(db);
    insertProvenanceLink(db, "claim:1", "supports", "msg:10", 0.9, "user stated");
    const links = getProvenanceLinksForSubject(db, "claim:1");
    expect(links.length).toBe(1);
    expect(links[0].predicate).toBe("supports");
  });

  it("seeded data round-trips through reader correctly", () => {
    seedClaim(db);
    seedDecision(db);
    seedLoop(db);
    seedAttempt(db);
    seedEntity(db);
    seedRunbook(db);
    seedAntiRunbook(db);
    seedInvariant(db);

    const results = readMemoryObjects(db, { limit: 100 });
    expect(results.length).toBe(8);

    const kindSet = new Set(results.map((r) => r.kind));
    expect(kindSet.has("claim")).toBe(true);
    expect(kindSet.has("decision")).toBe(true);
    expect(kindSet.has("loop")).toBe(true);
    expect(kindSet.has("attempt")).toBe(true);
    expect(kindSet.has("entity")).toBe(true);
    expect(kindSet.has("procedure")).toBe(true);
    expect(kindSet.has("invariant")).toBe(true);

    // Every object has required fields
    for (const obj of results) {
      expect(obj.id).toBeTruthy();
      expect(obj.kind).toBeTruthy();
      expect(obj.content).toBeTruthy();
      expect(obj.provenance).toBeDefined();
      expect(obj.provenance.trust).toBeGreaterThanOrEqual(0);
      expect(obj.provenance.trust).toBeLessThanOrEqual(1);
      expect(obj.confidence).toBeGreaterThanOrEqual(0);
      expect(obj.confidence).toBeLessThanOrEqual(1);
      expect(obj.status).toBeTruthy();
      expect(obj.created_at).toBeTruthy();
    }
  });
});

// ============================================================================
// Canonical key consistency (critical for TruthEngine)
// ============================================================================

describe("RSMA Reader: canonical key consistency", () => {
  it("claim canonical_key is recomputed, not read from DB", () => {
    seedClaim(db, { subject: "PostgreSQL", predicate: "Is Used For" });
    const results = readMemoryObjects(db, { kinds: ["claim"] });
    expect(results.length).toBe(1);
    // Should be normalized: lowercase, trimmed
    expect(results[0].canonical_key).toBe("claim::postgresql::is used for");
  });

  it("decision canonical_key is computed via buildCanonicalKey", () => {
    seedDecision(db, { topic: "  Staging Database  " });
    const results = readMemoryObjects(db, { kinds: ["decision"] });
    expect(results.length).toBe(1);
    expect(results[0].canonical_key).toBe("decision::staging database");
  });

  it("different claims produce different canonical keys", () => {
    seedClaim(db, { subject: "postgres", predicate: "is_used_for", canonical_key: "x" });
    seedClaim(db, { subject: "mysql", predicate: "is_used_for", canonical_key: "y" });
    const results = readMemoryObjects(db, { kinds: ["claim"], limit: 10 });
    expect(results.length).toBe(2);
    expect(results[0].canonical_key).not.toBe(results[1].canonical_key);
  });
});

// ============================================================================
// Relevance scoring bounds
// ============================================================================

describe("RSMA Reader: relevance score bounds", () => {
  it("computeRelevance always returns [0, 1] for random signals", () => {
    for (let i = 0; i < 100; i++) {
      const signals = {
        semantic: Math.random(),
        recency: Math.random(),
        trust: Math.random(),
        conflict: Math.random(),
        influence: Math.random(),
        status_penalty: Math.random(),
      };
      const score = computeRelevance(signals, TASK_MODE_WEIGHTS.default);
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(1);
    }
  });
});

// ============================================================================
// readMemoryObjectById for all kinds
// ============================================================================

describe("RSMA Reader: readMemoryObjectById all kinds", () => {
  it("finds loop by composite ID", () => {
    const id = seedLoop(db);
    const obj = readMemoryObjectById(db, `loop:${id}`);
    expect(obj).toBeDefined();
    expect(obj!.kind).toBe("loop");
  });

  it("finds attempt by composite ID", () => {
    const id = seedAttempt(db);
    const obj = readMemoryObjectById(db, `attempt:${id}`);
    expect(obj).toBeDefined();
    expect(obj!.kind).toBe("attempt");
  });

  it("finds entity by composite ID", () => {
    const id = seedEntity(db);
    const obj = readMemoryObjectById(db, `entity:${id}`);
    expect(obj).toBeDefined();
    expect(obj!.kind).toBe("entity");
  });

  it("finds runbook by composite ID", () => {
    const id = seedRunbook(db);
    const obj = readMemoryObjectById(db, `procedure:${id}`);
    expect(obj).toBeDefined();
    expect(obj!.kind).toBe("procedure");
  });

  it("finds invariant by composite ID", () => {
    const id = seedInvariant(db);
    const obj = readMemoryObjectById(db, `invariant:${id}`);
    expect(obj).toBeDefined();
    expect(obj!.kind).toBe("invariant");
  });
});
