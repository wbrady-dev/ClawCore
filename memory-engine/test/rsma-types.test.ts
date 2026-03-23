/**
 * RSMA Types + Provenance Links Schema Tests.
 *
 * Validates that:
 * - The ontology types are correctly defined and exported
 * - The provenance_links migration creates the table
 * - Relevance scoring math is correct
 * - Task mode weights sum to 1.0
 */

import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { runGraphMigrations } from "../src/relations/schema.js";
import type { GraphDb } from "../src/relations/types.js";
import {
  computeRelevance,
  TASK_MODE_WEIGHTS,
  SOURCE_TRUST,
  INFLUENCE_SCORES,
  CORRECTION_TRUST_BONUS,
  PROVISIONAL_CONFIDENCE_FACTOR,
  type MemoryKind,
  type LinkPredicate,
  type TaskMode,
  type RelevanceSignals,
} from "../src/ontology/types.js";

function createDb(): GraphDb {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  return db as unknown as GraphDb;
}

// ============================================================================
// Schema: provenance_links table
// ============================================================================

describe("RSMA: provenance_links migration", () => {
  it("creates provenance_links table", () => {
    const db = createDb();
    runGraphMigrations(db);

    const tables = (db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='provenance_links'",
    ).all() as Array<{ name: string }>).map((r) => r.name);
    expect(tables).toContain("provenance_links");
  });

  it("provenance_links has correct columns", () => {
    const db = createDb();
    runGraphMigrations(db);

    const columns = (db.prepare("PRAGMA table_info(provenance_links)").all() as Array<{ name: string }>)
      .map((c) => c.name);
    expect(columns).toContain("id");
    expect(columns).toContain("subject_id");
    expect(columns).toContain("predicate");
    expect(columns).toContain("object_id");
    expect(columns).toContain("confidence");
    expect(columns).toContain("detail");
    expect(columns).toContain("created_at");
  });

  it("enforces UNIQUE(subject_id, predicate, object_id)", () => {
    const db = createDb();
    runGraphMigrations(db);

    db.prepare(
      "INSERT INTO provenance_links (subject_id, predicate, object_id, confidence) VALUES (?, ?, ?, ?)",
    ).run("a", "supports", "b", 0.9);

    // Duplicate should fail
    expect(() => {
      db.prepare(
        "INSERT INTO provenance_links (subject_id, predicate, object_id, confidence) VALUES (?, ?, ?, ?)",
      ).run("a", "supports", "b", 0.8);
    }).toThrow();
  });

  it("allows same subject+object with different predicates", () => {
    const db = createDb();
    runGraphMigrations(db);

    db.prepare(
      "INSERT INTO provenance_links (subject_id, predicate, object_id, confidence) VALUES (?, ?, ?, ?)",
    ).run("a", "supports", "b", 0.9);

    db.prepare(
      "INSERT INTO provenance_links (subject_id, predicate, object_id, confidence) VALUES (?, ?, ?, ?)",
    ).run("a", "contradicts", "b", 0.7);

    const count = (db.prepare("SELECT COUNT(*) as cnt FROM provenance_links").get() as { cnt: number }).cnt;
    expect(count).toBe(2);
  });

  it("indexes exist for subject, object, and predicate", () => {
    const db = createDb();
    runGraphMigrations(db);

    const indexes = (db.prepare(
      "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='provenance_links'",
    ).all() as Array<{ name: string }>).map((r) => r.name);
    expect(indexes).toContain("idx_prov_subject");
    expect(indexes).toContain("idx_prov_object");
    expect(indexes).toContain("idx_prov_predicate");
    expect(indexes).toContain("idx_prov_created_at");
  });

  it("rejects invalid predicates via CHECK constraint", () => {
    const db = createDb();
    runGraphMigrations(db);
    expect(() => {
      db.prepare(
        "INSERT INTO provenance_links (subject_id, predicate, object_id, confidence) VALUES (?, ?, ?, ?)",
      ).run("a", "invalid_predicate", "b", 0.9);
    }).toThrow();
  });

  it("rejects confidence > 1.0 via CHECK constraint", () => {
    const db = createDb();
    runGraphMigrations(db);
    expect(() => {
      db.prepare(
        "INSERT INTO provenance_links (subject_id, predicate, object_id, confidence) VALUES (?, ?, ?, ?)",
      ).run("a", "supports", "b", 1.5);
    }).toThrow();
  });

  it("rejects negative confidence via CHECK constraint", () => {
    const db = createDb();
    runGraphMigrations(db);
    expect(() => {
      db.prepare(
        "INSERT INTO provenance_links (subject_id, predicate, object_id, confidence) VALUES (?, ?, ?, ?)",
      ).run("a", "supports", "b", -0.5);
    }).toThrow();
  });

  it("rejects NULL subject_id", () => {
    const db = createDb();
    runGraphMigrations(db);
    expect(() => {
      db.prepare(
        "INSERT INTO provenance_links (subject_id, predicate, object_id, confidence) VALUES (?, ?, ?, ?)",
      ).run(null, "supports", "b", 0.9);
    }).toThrow();
  });

  it("rejects NULL predicate", () => {
    const db = createDb();
    runGraphMigrations(db);
    expect(() => {
      db.prepare(
        "INSERT INTO provenance_links (subject_id, predicate, object_id, confidence) VALUES (?, ?, ?, ?)",
      ).run("a", null, "b", 0.9);
    }).toThrow();
  });

  it("migration is idempotent", () => {
    const db = createDb();
    runGraphMigrations(db);
    runGraphMigrations(db); // second run should be safe
    const tables = (db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='provenance_links'",
    ).all() as Array<{ name: string }>).map((r) => r.name);
    expect(tables).toContain("provenance_links");
  });
});

// ============================================================================
// Types: Relevance scoring
// ============================================================================

describe("RSMA: Relevance scoring", () => {
  it("computeRelevance produces correct weighted sum", () => {
    const signals: RelevanceSignals = {
      semantic: 0.8,
      recency: 0.6,
      trust: 0.9,
      conflict: 0.0,
      influence: 0.5,
      status_penalty: 1.0,
    };
    const weights = TASK_MODE_WEIGHTS.default;
    const score = computeRelevance(signals, weights);

    const expected =
      0.8 * 0.3 +  // semantic
      0.6 * 0.2 +  // recency
      0.9 * 0.15 + // trust
      0.0 * 0.15 + // conflict
      0.5 * 0.2;   // influence
    expect(score).toBeCloseTo(expected, 6);
  });

  it("status_penalty zeroes out superseded objects", () => {
    const signals: RelevanceSignals = {
      semantic: 1.0,
      recency: 1.0,
      trust: 1.0,
      conflict: 1.0,
      influence: 1.0,
      status_penalty: 0.0,
    };
    expect(computeRelevance(signals, TASK_MODE_WEIGHTS.default)).toBe(0);
  });

  it("stale objects get reduced but not zeroed", () => {
    const active: RelevanceSignals = {
      semantic: 0.5, recency: 0.5, trust: 0.5, conflict: 0, influence: 0.5,
      status_penalty: 1.0,
    };
    const stale: RelevanceSignals = { ...active, status_penalty: 0.3 };

    const activeScore = computeRelevance(active, TASK_MODE_WEIGHTS.default);
    const staleScore = computeRelevance(stale, TASK_MODE_WEIGHTS.default);
    expect(staleScore).toBeLessThan(activeScore);
    expect(staleScore).toBeGreaterThan(0);
  });
});

// ============================================================================
// Types: Task mode weights
// ============================================================================

describe("RSMA: Task mode weights", () => {
  const modes: TaskMode[] = ["coding", "planning", "troubleshooting", "recall", "default"];

  for (const mode of modes) {
    it(`${mode} weights sum to 1.0`, () => {
      const w = TASK_MODE_WEIGHTS[mode];
      const sum = w.semantic + w.recency + w.trust + w.conflict + w.influence;
      expect(sum).toBeCloseTo(1.0, 6);
    });

    it(`${mode} weights are all non-negative`, () => {
      const w = TASK_MODE_WEIGHTS[mode];
      expect(w.semantic).toBeGreaterThanOrEqual(0);
      expect(w.recency).toBeGreaterThanOrEqual(0);
      expect(w.trust).toBeGreaterThanOrEqual(0);
      expect(w.conflict).toBeGreaterThanOrEqual(0);
      expect(w.influence).toBeGreaterThanOrEqual(0);
    });
  }
});

// ============================================================================
// Types: Source trust + influence scores
// ============================================================================

describe("RSMA: Source trust hierarchy", () => {
  it("tool_result has highest trust", () => {
    expect(SOURCE_TRUST.tool_result).toBe(1.0);
  });

  it("full trust order: tool_result > user_explicit > document > message > extraction > compaction > inference", () => {
    expect(SOURCE_TRUST.tool_result).toBeGreaterThan(SOURCE_TRUST.user_explicit);
    expect(SOURCE_TRUST.user_explicit).toBeGreaterThan(SOURCE_TRUST.document);
    expect(SOURCE_TRUST.document).toBeGreaterThan(SOURCE_TRUST.message);
    expect(SOURCE_TRUST.message).toBeGreaterThan(SOURCE_TRUST.extraction);
    expect(SOURCE_TRUST.extraction).toBeGreaterThan(SOURCE_TRUST.compaction);
    expect(SOURCE_TRUST.compaction).toBeGreaterThan(SOURCE_TRUST.inference);
  });

  it("correction bonus is positive", () => {
    expect(CORRECTION_TRUST_BONUS).toBeGreaterThan(0);
  });

  it("provisional factor halves confidence", () => {
    expect(PROVISIONAL_CONFIDENCE_FACTOR).toBe(0.5);
  });
});

describe("RSMA: Influence scores", () => {
  it("critical > high > standard > low", () => {
    expect(INFLUENCE_SCORES.critical).toBeGreaterThan(INFLUENCE_SCORES.high);
    expect(INFLUENCE_SCORES.high).toBeGreaterThan(INFLUENCE_SCORES.standard);
    expect(INFLUENCE_SCORES.standard).toBeGreaterThan(INFLUENCE_SCORES.low);
  });
});
