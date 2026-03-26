import { DatabaseSync } from "node:sqlite";
import { describe, expect, it, beforeEach, vi } from "vitest";
import { runGraphMigrations } from "../src/relations/schema.js";
import { decayRelations } from "../src/relations/decay.js";
import { synthesizeScope } from "../src/relations/synthesis.js";
import { upsertClaim } from "../src/relations/claim-store.js";
import type { GraphDb } from "../src/relations/types.js";
import type { LcmDependencies } from "../src/types.js";
import type { LcmConfig } from "../src/db/config.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createInMemoryDb(): GraphDb {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  return db as unknown as GraphDb;
}

function insertRelation(
  db: GraphDb,
  compositeId: string,
  content: string,
  ageDays: string = "-200 days",
  status: string = "active",
): void {
  (db as unknown as DatabaseSync)
    .prepare(
      `INSERT INTO memory_objects
         (composite_id, kind, content, structured_json, canonical_key, scope_id, branch_id,
          confidence, trust_score, status, influence_weight,
          observed_at, last_observed_at, created_at, updated_at)
       VALUES (?, 'relation', ?, '{}', NULL, 1, 0,
               0.8, 1.0, ?, 'standard',
               datetime('now'), datetime('now'), datetime('now'), datetime('now', ?))`,
    )
    .run(compositeId, content, status, ageDays);
}

function makeDeps(overrides?: Partial<LcmDependencies>): LcmDependencies {
  return {
    config: {
      enabled: true,
      databasePath: ":memory:",
      contextThreshold: 0.75,
      freshTailCount: 8,
      leafMinFanout: 8,
      condensedMinFanout: 4,
      condensedMinFanoutHard: 2,
      incrementalMaxDepth: 0,
      leafChunkTokens: 20_000,
      leafTargetTokens: 600,
      condensedTargetTokens: 900,
      maxExpandTokens: 120,
      largeFileTokenThreshold: 25_000,
      largeFileSummaryProvider: "",
      largeFileSummaryModel: "",
      summaryModel: "",
      summaryProvider: "",
      autocompactDisabled: false,
      timezone: "UTC",
      pruneHeartbeatOk: false,
      relationsEnabled: false,
      relationsGraphDbPath: ":memory:",
      relationsMinMentions: 2,
      relationsStaleDays: 30,
      relationsAwarenessEnabled: false,
      relationsAwarenessMaxNotes: 3,
      relationsAwarenessMaxTokens: 100,
      relationsAwarenessDocSurfacing: false,
      relationsClaimExtractionEnabled: false,
      relationsUserClaimExtractionEnabled: false,
      relationsContextTier: "standard",
      relationsAttemptTrackingEnabled: false,
      relationsDecayIntervalDays: 90,
      relationsDeepExtractionEnabled: false,
      relationsDeepExtractionModel: "",
      relationsDeepExtractionProvider: "",
    },
    complete: vi.fn(async () => ({
      content: [{ type: "text", text: "Synthesis summary" }],
    })),
    callGateway: vi.fn(async () => ({})),
    resolveModel: vi.fn(() => ({
      provider: "mock",
      model: "test",
    })),
    getApiKey: vi.fn(async () => "test-api-key"),
    requireApiKey: vi.fn(async () => "test-api-key"),
    parseAgentSessionKey: vi.fn(() => null),
    isSubagentSessionKey: vi.fn(() => false),
    normalizeAgentId: vi.fn(() => "main"),
    buildSubagentSystemPrompt: vi.fn(() => ""),
    readLatestAssistantReply: vi.fn(() => undefined),
    resolveAgentDir: vi.fn(() => "/tmp/openclaw-agent"),
    resolveSessionIdFromSessionKey: vi.fn(async () => undefined),
    agentLaneSubagent: "subagent",
    log: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    },
    ...overrides,
  } as LcmDependencies;
}

function makeConfig(overrides?: Partial<LcmConfig>): LcmConfig {
  const deps = makeDeps();
  return { ...deps.config, ...overrides } as LcmConfig;
}

// ---------------------------------------------------------------------------
// decayRelations — synchronous, pure DB
// ---------------------------------------------------------------------------

describe("decayRelations", () => {
  let db: GraphDb;

  beforeEach(() => {
    db = createInMemoryDb();
    runGraphMigrations(db);
  });

  it("marks relations stale when updated_at exceeds staleDays", () => {
    insertRelation(db, "rel:test:old", "A relates to B", "-200 days");

    decayRelations(db, 1, 180);

    const row = (db as unknown as DatabaseSync)
      .prepare("SELECT status FROM memory_objects WHERE composite_id = 'rel:test:old'")
      .get() as { status: string } | undefined;

    expect(row).toBeDefined();
    expect(row!.status).toBe("stale");
  });

  it("does not mark recently-updated relations stale", () => {
    insertRelation(db, "rel:test:recent", "A relates to B", "-1 days");

    decayRelations(db, 1, 180);

    const row = (db as unknown as DatabaseSync)
      .prepare("SELECT status FROM memory_objects WHERE composite_id = 'rel:test:recent'")
      .get() as { status: string } | undefined;

    expect(row).toBeDefined();
    expect(row!.status).toBe("active");
  });

  it("returns count of staled relations", () => {
    insertRelation(db, "rel:test:a", "Relation A", "-200 days");
    insertRelation(db, "rel:test:b", "Relation B", "-200 days");
    insertRelation(db, "rel:test:c", "Relation C", "-200 days");

    const count = decayRelations(db, 1, 180);

    expect(count).toBe(3);
  });

  it("logs evidence_log entry on decay", () => {
    insertRelation(db, "rel:test:decay-log", "Decayable", "-200 days");

    decayRelations(db, 1, 180);

    const row = (db as unknown as DatabaseSync)
      .prepare("SELECT * FROM evidence_log WHERE event_type = 'decay'")
      .get() as Record<string, unknown> | undefined;

    expect(row).toBeDefined();
    expect(row!.event_type).toBe("decay");
  });

  it("is idempotent — already-stale relations not re-processed", () => {
    insertRelation(db, "rel:test:stale-already", "Already stale", "-200 days", "stale");

    const count = decayRelations(db, 1, 180);

    expect(count).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// synthesizeScope — async, needs LLM mock
// ---------------------------------------------------------------------------

describe("synthesizeScope", () => {
  let db: GraphDb;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createInMemoryDb();
    runGraphMigrations(db);
  });

  it("returns null when no evidence exists", async () => {
    const deps = makeDeps();
    const config = makeConfig({ relationsDeepExtractionEnabled: true });

    const result = await synthesizeScope(db, 1, deps, config);

    expect(result).toBeNull();
  });

  it("returns synthesis text when evidence exists", async () => {
    const deps = makeDeps();
    const config = makeConfig({ relationsDeepExtractionEnabled: true });

    // Insert a claim so evidence is non-empty
    upsertClaim(db, {
      scopeId: 1,
      subject: "TypeScript",
      predicate: "is_used_for",
      objectText: "development",
      canonicalKey: "claim::typescript::is_used_for",
      confidence: 0.9,
    });

    const result = await synthesizeScope(db, 1, deps, config);

    expect(result).not.toBeNull();
    expect(typeof result).toBe("string");
    expect(result).toBe("Synthesis summary");
    expect(deps.complete).toHaveBeenCalledTimes(1);
  });

  it("returns null when LLM call fails", async () => {
    const deps = makeDeps({
      complete: vi.fn(async () => {
        throw new Error("LLM unavailable");
      }),
    });
    const config = makeConfig({ relationsDeepExtractionEnabled: true });

    // Insert a claim so we get past the empty-evidence guard
    upsertClaim(db, {
      scopeId: 1,
      subject: "Node",
      predicate: "runs_on",
      objectText: "server",
      canonicalKey: "claim::node::runs_on",
      confidence: 0.8,
    });

    const result = await synthesizeScope(db, 1, deps, config);

    expect(result).toBeNull();
  });
});
