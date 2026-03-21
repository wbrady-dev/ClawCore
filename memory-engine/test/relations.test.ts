import { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it } from "vitest";
import { runGraphMigrations } from "../src/relations/schema.js";
import { extractFast } from "../src/relations/entity-extract.js";
import { effectiveConfidence } from "../src/relations/confidence.js";
import {
  buildAwarenessNote,
  extractTextFromAgentMessage,
  resetEntityCacheForTests,
} from "../src/relations/awareness.js";
import {
  recordAwarenessEvent,
  getAwarenessStats,
  resetAwarenessEventsForTests,
} from "../src/relations/eval.js";
import {
  withWriteTransaction,
  writeWithIdempotency,
  nextScopeSeq,
  logEvidence,
} from "../src/relations/evidence-log.js";
import {
  upsertEntity,
  insertMention,
  deleteGraphDataForSource,
  storeExtractionResult,
  reExtractGraphForDocument,
} from "../src/relations/graph-store.js";
import type { GraphDb } from "../src/relations/types.js";

function createInMemoryDb(): GraphDb {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  return db as unknown as GraphDb;
}

describe("Relations: Schema", () => {
  it("migration v1 creates all tables", () => {
    const db = createInMemoryDb();
    runGraphMigrations(db);

    // Check tables exist
    const tables = (db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
    ).all() as Array<{ name: string }>).map((r) => r.name);

    expect(tables).toContain("evidence_log");
    expect(tables).toContain("scope_sequences");
    expect(tables).toContain("state_scopes");
    expect(tables).toContain("branch_scopes");
    expect(tables).toContain("promotion_policies");
    expect(tables).toContain("entities");
    expect(tables).toContain("entity_mentions");
    expect(tables).toContain("_evidence_migrations");
  });

  it("migration is idempotent (run twice without error)", () => {
    const db = createInMemoryDb();
    runGraphMigrations(db);
    runGraphMigrations(db); // second run should be no-op
    const version = db.prepare(
      "SELECT version FROM _evidence_migrations WHERE version = 1",
    ).get() as { version: number };
    expect(version.version).toBe(1);
  });

  it("seeds global scope row", () => {
    const db = createInMemoryDb();
    runGraphMigrations(db);
    const scope = db.prepare(
      "SELECT id, scope_type, scope_key FROM state_scopes WHERE id = 1",
    ).get() as { id: number; scope_type: string; scope_key: string };
    expect(scope).toEqual({ id: 1, scope_type: "system", scope_key: "global" });
  });

  it("seeds default promotion policies", () => {
    const db = createInMemoryDb();
    runGraphMigrations(db);
    const policies = db.prepare("SELECT object_type FROM promotion_policies").all() as Array<{ object_type: string }>;
    const types = policies.map((p) => p.object_type);
    expect(types).toContain("entity");
    expect(types).toContain("claim");
    expect(types).toContain("decision");
    expect(types).toContain("invariant");
    expect(types.length).toBe(10);
  });
});

describe("Relations: Entity Extraction", () => {
  it("extracts capitalized multi-word phrases", () => {
    const results = extractFast("Alex Morgan went to New York City today.");
    const names = results.map((r) => r.name.toLowerCase());
    expect(names).toContain("alex morgan");
    expect(names).toContain("new york city");
  });

  it("filters month names as false positives", () => {
    const results = extractFast("January Report was filed last week.");
    const names = results.map((r) => r.name.toLowerCase());
    expect(names).not.toContain("january report");
  });

  it("extracts terms-list matches with high confidence", () => {
    const results = extractFast("The OpenClaw system is running well.", ["OpenClaw"]);
    expect(results.length).toBeGreaterThanOrEqual(1);
    const oc = results.find((r) => r.name.toLowerCase() === "openclaw");
    expect(oc).toBeDefined();
    expect(oc!.confidence).toBe(0.9);
    expect(oc!.strategy).toBe("terms_list");
  });

  it("extracts quoted terms", () => {
    // Use a non-capitalized quoted term so it doesn't also match the capitalized strategy
    const results = extractFast('He mentioned "alpha project" yesterday.');
    const names = results.map((r) => r.name.toLowerCase());
    expect(names).toContain("alpha project");
    const ap = results.find((r) => r.name.toLowerCase() === "alpha project");
    expect(ap!.confidence).toBe(0.5);
    expect(ap!.strategy).toBe("quoted");
  });

  it("filters code-like quoted terms", () => {
    const results = extractFast('Import "src/utils/helper.ts" for the function.');
    const names = results.map((r) => r.name.toLowerCase());
    expect(names).not.toContain("src/utils/helper.ts");
  });

  it("deduplicates by name, keeping highest confidence", () => {
    const results = extractFast(
      'Alex Morgan said "Alex Morgan" is the developer.',
      ["Alex Morgan"],
    );
    const wb = results.filter((r) => r.name.toLowerCase() === "alex morgan");
    expect(wb.length).toBe(1);
    expect(wb[0].confidence).toBe(0.9); // terms_list wins over capitalized (0.6)
  });

  it("records co-occurring terms as contextTerms", () => {
    const results = extractFast(
      "OpenClaw uses ClawCore for memory management.",
      ["OpenClaw", "ClawCore"],
    );
    for (const r of results) {
      expect(r.contextTerms).toBeDefined();
      expect(r.contextTerms!.length).toBeGreaterThanOrEqual(2);
    }
  });

  it("returns empty for empty text", () => {
    expect(extractFast("")).toEqual([]);
    expect(extractFast("", ["term"])).toEqual([]);
  });
});

describe("Relations: Evidence Log", () => {
  let db: GraphDb;

  beforeEach(() => {
    db = createInMemoryDb();
    runGraphMigrations(db);
  });

  it("nextScopeSeq increments monotonically", () => {
    const seq1 = nextScopeSeq(db, 1);
    const seq2 = nextScopeSeq(db, 1);
    const seq3 = nextScopeSeq(db, 1);
    expect(seq1).toBe(1);
    expect(seq2).toBe(2);
    expect(seq3).toBe(3);
  });

  it("nextScopeSeq creates counter for new scopes", () => {
    const seq = nextScopeSeq(db, 999);
    expect(seq).toBe(1);
  });

  it("logEvidence appends to evidence_log with scope_seq", () => {
    logEvidence(db, {
      scopeId: 1,
      objectType: "entity",
      objectId: 42,
      eventType: "create",
      actor: "system",
    });
    const row = db.prepare("SELECT * FROM evidence_log WHERE object_id = 42").get() as Record<string, unknown>;
    expect(row).toBeDefined();
    expect(row.scope_seq).toBe(1);
    expect(row.event_type).toBe("create");
  });

  it("evidence_log timestamps have millisecond precision", () => {
    logEvidence(db, {
      objectType: "test",
      objectId: 1,
      eventType: "test",
    });
    const row = db.prepare("SELECT created_at FROM evidence_log LIMIT 1").get() as { created_at: string };
    // Format: YYYY-MM-DDTHH:MM:SS.fff
    expect(row.created_at).toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}/);
  });

  it("withWriteTransaction commits on success", () => {
    withWriteTransaction(db, () => {
      db.prepare("INSERT INTO entities (name, display_name, first_seen_at, last_seen_at) VALUES (?, ?, datetime('now'), datetime('now'))").run("test", "Test");
    });
    const row = db.prepare("SELECT name FROM entities WHERE name = 'test'").get();
    expect(row).toBeDefined();
  });

  it("withWriteTransaction rolls back on error", () => {
    expect(() => {
      withWriteTransaction(db, () => {
        db.prepare("INSERT INTO entities (name, display_name, first_seen_at, last_seen_at) VALUES (?, ?, datetime('now'), datetime('now'))").run("rollback_test", "Rollback");
        throw new Error("deliberate failure");
      });
    }).toThrow("deliberate failure");
    const row = db.prepare("SELECT name FROM entities WHERE name = 'rollback_test'").get();
    expect(row).toBeUndefined();
  });

  it("writeWithIdempotency returns null on duplicate key", () => {
    logEvidence(db, {
      objectType: "test",
      objectId: 1,
      eventType: "create",
      idempotencyKey: "test-key-1",
    });
    const result = writeWithIdempotency(db, "test-key-1", () => {
      logEvidence(db, {
        objectType: "test",
        objectId: 2,
        eventType: "create",
        idempotencyKey: "test-key-1",
      });
      return "should not reach";
    });
    expect(result).toBeNull();
  });
});

describe("Relations: Graph Store", () => {
  let db: GraphDb;

  beforeEach(() => {
    db = createInMemoryDb();
    runGraphMigrations(db);
  });

  it("upsertEntity creates new entity with isNew=true", () => {
    const result = upsertEntity(db, { name: "OpenClaw" });
    expect(result.entityId).toBeGreaterThan(0);
    expect(result.isNew).toBe(true);
    const row = db.prepare("SELECT name, mention_count FROM entities WHERE id = ?").get(result.entityId) as { name: string; mention_count: number };
    expect(row.name).toBe("openclaw");
    expect(row.mention_count).toBe(1);
  });

  it("upsertEntity returns isNew=false on conflict and increments mention_count", () => {
    const first = upsertEntity(db, { name: "OpenClaw" });
    expect(first.isNew).toBe(true);
    const second = upsertEntity(db, { name: "openclaw" }); // same name, different casing
    expect(second.isNew).toBe(false);
    expect(second.entityId).toBe(first.entityId);
    const row = db.prepare("SELECT mention_count FROM entities WHERE name = 'openclaw'").get() as { mention_count: number };
    expect(row.mention_count).toBe(2);
  });

  it("insertMention returns true on first insert", () => {
    const { entityId } = upsertEntity(db, { name: "TestEntity" });
    const first = insertMention(db, {
      entityId,
      sourceType: "document",
      sourceId: "doc-1",
    });
    expect(first).toBe(true);
  });

  it("insertMention allows multiple mentions from same source (by design)", () => {
    const { entityId } = upsertEntity(db, { name: "MultiMention" });
    insertMention(db, { entityId, sourceType: "document", sourceId: "doc-1" });
    insertMention(db, { entityId, sourceType: "document", sourceId: "doc-1" });
    const count = db.prepare(
      "SELECT COUNT(*) as cnt FROM entity_mentions WHERE entity_id = ?",
    ).get(entityId) as { cnt: number };
    // Multiple mentions from the same source are allowed — each extraction pass creates one
    expect(count.cnt).toBe(2);
  });

  it("insertMention stores context_terms as JSON", () => {
    const { entityId } = upsertEntity(db, { name: "TestEntity" });
    insertMention(db, {
      entityId,
      sourceType: "document",
      sourceId: "doc-1",
      contextTerms: ["OpenClaw", "ClawCore"],
    });
    const row = db.prepare(
      "SELECT context_terms FROM entity_mentions WHERE entity_id = ?",
    ).get(entityId) as { context_terms: string };
    expect(JSON.parse(row.context_terms)).toEqual(["OpenClaw", "ClawCore"]);
  });

  it("deleteGraphDataForSource removes mentions and decrements counts", () => {
    const { entityId } = upsertEntity(db, { name: "Ephemeral" });
    insertMention(db, { entityId, sourceType: "document", sourceId: "doc-1" });

    const result = deleteGraphDataForSource(db, "document", "doc-1");
    expect(result.mentionsDeleted).toBe(1);

    // Entity should be cleaned up (mention_count went to 0)
    const entity = db.prepare("SELECT * FROM entities WHERE id = ?").get(entityId);
    expect(entity).toBeUndefined(); // orphan cleaned
  });

  it("deleteGraphDataForSource preserves entities with other mentions", () => {
    const { entityId } = upsertEntity(db, { name: "Shared" });
    upsertEntity(db, { name: "Shared" }); // bump count to 2
    insertMention(db, { entityId, sourceType: "document", sourceId: "doc-1" });
    insertMention(db, { entityId, sourceType: "document", sourceId: "doc-2" });

    deleteGraphDataForSource(db, "document", "doc-1");

    const entity = db.prepare("SELECT mention_count FROM entities WHERE id = ?").get(entityId) as { mention_count: number };
    expect(entity).toBeDefined();
    expect(entity.mention_count).toBe(1); // decremented from 2 to 1
  });

  it("storeExtractionResult creates entities, mentions, and logs evidence", () => {
    const results = extractFast("Alex Morgan discussed OpenClaw.", ["OpenClaw"]);
    storeExtractionResult(db, results, {
      sourceType: "message",
      sourceId: "msg-1",
    });

    const entities = db.prepare("SELECT * FROM entities").all() as Array<{ name: string }>;
    expect(entities.length).toBeGreaterThanOrEqual(1);

    const mentions = db.prepare("SELECT * FROM entity_mentions").all();
    expect(mentions.length).toBeGreaterThanOrEqual(1);

    const events = db.prepare("SELECT * FROM evidence_log WHERE event_type = 'mention_insert'").all();
    expect(events.length).toBeGreaterThanOrEqual(1);
  });
});

describe("Relations: Confidence Decay", () => {
  it("full confidence for recent entity with many mentions", () => {
    const c = effectiveConfidence(0.9, 5, 1);
    expect(c).toBeCloseTo(0.9); // min(1, 5/3)=1, recency=1.0
  });

  it("reduced confidence for old entity", () => {
    const c = effectiveConfidence(0.9, 5, 100);
    expect(c).toBeCloseTo(0.9 * 1.0 * 0.3); // >90 days → 0.3
  });

  it("reduced confidence for low mention count", () => {
    const c = effectiveConfidence(0.9, 1, 1);
    expect(c).toBeCloseTo(0.9 * (1 / 3) * 1.0);
  });

  it("recency weights are correct at boundaries", () => {
    // < 7 days → 1.0
    expect(effectiveConfidence(1, 3, 6)).toBeCloseTo(1.0);
    // < 30 days → 0.8
    expect(effectiveConfidence(1, 3, 15)).toBeCloseTo(0.8);
    // < 90 days → 0.5
    expect(effectiveConfidence(1, 3, 60)).toBeCloseTo(0.5);
    // >= 90 days → 0.3
    expect(effectiveConfidence(1, 3, 90)).toBeCloseTo(0.3);
  });
});

describe("Relations: scope_seq total ordering", () => {
  it("produces monotonic sequence across different object types", () => {
    const db = createInMemoryDb();
    runGraphMigrations(db);

    // Log events of different types to the same scope
    logEvidence(db, { scopeId: 1, objectType: "entity", objectId: 1, eventType: "create" });
    logEvidence(db, { scopeId: 1, objectType: "mention", objectId: 2, eventType: "create" });
    logEvidence(db, { scopeId: 1, objectType: "claim", objectId: 3, eventType: "create" });

    const events = db.prepare(
      "SELECT scope_seq, object_type FROM evidence_log WHERE scope_id = 1 ORDER BY scope_seq",
    ).all() as Array<{ scope_seq: number; object_type: string }>;

    expect(events.length).toBe(3);
    expect(events[0].scope_seq).toBe(1);
    expect(events[1].scope_seq).toBe(2);
    expect(events[2].scope_seq).toBe(3);
  });
});

describe("Relations: Scope isolation", () => {
  it("entities in different scopes are independent", () => {
    const db = createInMemoryDb();
    runGraphMigrations(db);

    // Create two scope rows
    db.prepare(
      "INSERT INTO state_scopes (scope_type, scope_key, display_name) VALUES ('project', 'alpha', 'Alpha')",
    ).run();
    db.prepare(
      "INSERT INTO state_scopes (scope_type, scope_key, display_name) VALUES ('project', 'beta', 'Beta')",
    ).run();

    const alphaScope = (db.prepare(
      "SELECT id FROM state_scopes WHERE scope_key = 'alpha'",
    ).get() as { id: number }).id;
    const betaScope = (db.prepare(
      "SELECT id FROM state_scopes WHERE scope_key = 'beta'",
    ).get() as { id: number }).id;

    // Insert same entity name, different scopes
    const { entityId } = upsertEntity(db, { name: "Redis" });
    insertMention(db, { entityId, scopeId: alphaScope, sourceType: "document", sourceId: "doc-a" });
    insertMention(db, { entityId, scopeId: betaScope, sourceType: "document", sourceId: "doc-b" });

    // Scope-filtered queries should return only matching mentions
    const alphaMentions = db.prepare(
      "SELECT * FROM entity_mentions WHERE scope_id = ?",
    ).all(alphaScope);
    const betaMentions = db.prepare(
      "SELECT * FROM entity_mentions WHERE scope_id = ?",
    ).all(betaScope);

    expect(alphaMentions.length).toBe(1);
    expect(betaMentions.length).toBe(1);
  });
});

describe("Relations: reExtractGraphForDocument", () => {
  it("atomically deletes old data and re-extracts", () => {
    const db = createInMemoryDb();
    runGraphMigrations(db);

    // First extraction
    reExtractGraphForDocument(db, "doc-1", [
      { text: "Alex Morgan built OpenClaw for fun.", position: 0 },
    ], { termsListEntries: ["OpenClaw"] });

    const entitiesBefore = db.prepare("SELECT * FROM entities").all() as Array<{ name: string }>;
    const mentionsBefore = db.prepare(
      "SELECT * FROM entity_mentions WHERE source_id = 'doc-1'",
    ).all();
    expect(entitiesBefore.length).toBeGreaterThan(0);
    expect(mentionsBefore.length).toBeGreaterThan(0);

    // Re-extraction with different content — old mentions should be gone
    reExtractGraphForDocument(db, "doc-1", [
      { text: "ClawCore is a memory engine.", position: 0 },
    ], { termsListEntries: ["ClawCore"] });

    const mentionsAfter = db.prepare(
      "SELECT * FROM entity_mentions WHERE source_id = 'doc-1'",
    ).all();
    // Old mentions for doc-1 should be replaced with new ones
    expect(mentionsAfter.length).toBeGreaterThan(0);

    // "OpenClaw" mention from doc-1 should be gone (only ClawCore remains from doc-1)
    const openclawMentions = db.prepare(
      "SELECT em.* FROM entity_mentions em JOIN entities e ON em.entity_id = e.id WHERE e.name = 'openclaw' AND em.source_id = 'doc-1'",
    ).all();
    expect(openclawMentions.length).toBe(0);
  });
});

// ============================================================================
// Sprint 9: Awareness + Eval
// ============================================================================

describe("Relations: extractTextFromAgentMessage", () => {
  it("handles string content", () => {
    expect(extractTextFromAgentMessage({ content: "hello world" })).toBe("hello world");
  });

  it("handles array content blocks", () => {
    const msg = {
      content: [
        { type: "text", text: "first" },
        { type: "image", url: "img.png" },
        { type: "text", text: "second" },
      ],
    };
    expect(extractTextFromAgentMessage(msg)).toBe("first second");
  });

  it("handles null/undefined", () => {
    expect(extractTextFromAgentMessage(null)).toBe("");
    expect(extractTextFromAgentMessage(undefined)).toBe("");
  });

  it("handles empty object", () => {
    expect(extractTextFromAgentMessage({})).toBe("");
  });
});

describe("Relations: Awareness notes", () => {
  let db: GraphDb;

  beforeEach(() => {
    db = createInMemoryDb();
    runGraphMigrations(db);
    resetEntityCacheForTests();
    resetAwarenessEventsForTests();
  });

  it("returns null for empty messages", () => {
    const result = buildAwarenessNote([], db, {
      maxNotes: 3, maxTokens: 100, staleDays: 30, minMentions: 2, docSurfacing: false,
    });
    expect(result).toBeNull();
  });

  it("returns null when no entities match", () => {
    const result = buildAwarenessNote(
      [{ content: "just some random text with no known entities" }],
      db,
      { maxNotes: 3, maxTokens: 100, staleDays: 30, minMentions: 2, docSurfacing: false },
    );
    expect(result).toBeNull();
  });

  it("fires on mismatch scenario", () => {
    // Create entity with 2+ mentions (meets minMentions threshold)
    const { entityId } = upsertEntity(db, { name: "redis" });
    upsertEntity(db, { name: "redis" }); // bump to 2

    // Two mentions with different context terms
    insertMention(db, {
      entityId, sourceType: "document", sourceId: "doc-1",
      contextTerms: ["caching", "fast"],
    });
    insertMention(db, {
      entityId, sourceType: "document", sourceId: "doc-2",
      contextTerms: ["database", "persistent"],
    });

    const result = buildAwarenessNote(
      [{ content: "Let me check what we know about redis" }],
      db,
      { maxNotes: 3, maxTokens: 200, staleDays: 30, minMentions: 2, docSurfacing: false },
    );

    expect(result).not.toBeNull();
    expect(result).toContain("ClawCore Awareness");
    expect(result!.toLowerCase()).toContain("mismatch");
  });

  it("fires on staleness scenario", () => {
    // Create entity with old last_seen_at
    db.prepare(`
      INSERT INTO entities (name, display_name, first_seen_at, last_seen_at, mention_count)
      VALUES ('oldtool', 'OldTool', '2025-01-01T00:00:00.000', '2025-01-01T00:00:00.000', 3)
    `).run();

    const result = buildAwarenessNote(
      [{ content: "What about oldtool?" }],
      db,
      { maxNotes: 3, maxTokens: 200, staleDays: 30, minMentions: 2, docSurfacing: false },
    );

    expect(result).not.toBeNull();
    expect(result!.toLowerCase()).toContain("stale");
  });

  it("does not fire on unrelated message", () => {
    // Add some entities but don't mention them in the message
    upsertEntity(db, { name: "unrelated entity" });
    upsertEntity(db, { name: "unrelated entity" });

    const result = buildAwarenessNote(
      [{ content: "hello, how are you today?" }],
      db,
      { maxNotes: 3, maxTokens: 100, staleDays: 30, minMentions: 2, docSurfacing: false },
    );

    expect(result).toBeNull();
  });
});

describe("Relations: Eval harness", () => {
  beforeEach(() => {
    resetAwarenessEventsForTests();
  });

  it("records events and computes stats", () => {
    recordAwarenessEvent({ fired: true, noteCount: 2, noteTypes: ["mismatch", "staleness"], latencyMs: 10, terms: ["redis"], tokensAdded: 40 });
    recordAwarenessEvent({ fired: false, noteCount: 0, noteTypes: [], latencyMs: 5, terms: [], tokensAdded: 0 });
    recordAwarenessEvent({ fired: true, noteCount: 1, noteTypes: ["connection"], latencyMs: 15, terms: ["redis"], tokensAdded: 20 });

    const stats = getAwarenessStats();
    expect(stats.totalTurns).toBe(3);
    expect(stats.firedCount).toBe(2);
    expect(stats.fireRate).toBe(67); // 2/3 ≈ 67%
    expect(stats.avgTokensWhenFired).toBe(30); // (40+20)/2
    expect(stats.noteTypeBreakdown.mismatch).toBe(1);
    expect(stats.noteTypeBreakdown.staleness).toBe(1);
    expect(stats.noteTypeBreakdown.connection).toBe(1);
  });

  it("returns empty stats when no events", () => {
    const stats = getAwarenessStats();
    expect(stats.totalTurns).toBe(0);
    expect(stats.fireRate).toBe(0);
  });

  it("latency percentiles are computed correctly", () => {
    // Record 10 events with known latencies
    for (let i = 1; i <= 10; i++) {
      recordAwarenessEvent({ fired: false, noteCount: 0, noteTypes: [], latencyMs: i * 10, terms: [], tokensAdded: 0 });
    }
    const stats = getAwarenessStats();
    // floor(10 * 0.5) = 5 → index 5 (0-based) = 60ms
    expect(stats.latencyP50).toBe(60);
    // floor(10 * 0.95) = 9 → index 9 (0-based) = 100ms
    expect(stats.latencyP95).toBe(100);
  });
});
