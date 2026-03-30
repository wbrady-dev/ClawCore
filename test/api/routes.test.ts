/**
 * API route tests for ThreadClaw.
 *
 * Uses Fastify's app.inject() for in-process HTTP testing.
 * Mocks heavy dependencies (embedding server, query pipeline, ingest pipeline,
 * source adapters) while using a real in-memory SQLite database for storage.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import Database from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";
import Fastify, { type FastifyInstance } from "fastify";

// ---------------------------------------------------------------------------
// In-memory database setup
// ---------------------------------------------------------------------------

let testDb: Database.Database;

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  sqliteVec.load(db);

  // Run schema migrations inline (mirrors src/storage/schema.ts)
  const dim = 1024;

  db.exec(`CREATE TABLE IF NOT EXISTS collections (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`);

  db.exec(`CREATE TABLE IF NOT EXISTS documents (
    id TEXT PRIMARY KEY,
    collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
    source_path TEXT,
    content_hash TEXT NOT NULL,
    metadata_json TEXT,
    size_bytes INTEGER,
    created_at TEXT DEFAULT (datetime('now'))
  )`);

  db.exec(`CREATE TABLE IF NOT EXISTS chunks (
    id TEXT PRIMARY KEY,
    document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    text TEXT NOT NULL,
    context_prefix TEXT,
    position INTEGER,
    token_count INTEGER,
    content_hash TEXT NOT NULL
  )`);

  db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS chunk_vectors USING vec0(
    chunk_id TEXT PRIMARY KEY,
    embedding float[${dim}]
  )`);

  db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS chunk_fts USING fts5(
    text,
    content='chunks',
    content_rowid='rowid',
    tokenize='unicode61 remove_diacritics 2'
  )`);

  db.exec(`CREATE TRIGGER IF NOT EXISTS chunks_ai AFTER INSERT ON chunks BEGIN
    INSERT INTO chunk_fts(rowid, text) VALUES (new.rowid, new.text);
  END`);

  db.exec(`CREATE TRIGGER IF NOT EXISTS chunks_ad AFTER DELETE ON chunks BEGIN
    INSERT INTO chunk_fts(chunk_fts, rowid, text) VALUES('delete', old.rowid, old.text);
  END`);

  db.exec(`CREATE TABLE IF NOT EXISTS metadata_index (
    document_id TEXT REFERENCES documents(id) ON DELETE CASCADE,
    key TEXT NOT NULL,
    value TEXT NOT NULL
  )`);

  db.exec(`CREATE INDEX IF NOT EXISTS idx_metadata ON metadata_index(key, value)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_doc_collection ON documents(collection_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_chunk_document ON chunks(document_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_doc_hash ON documents(content_hash)`);

  db.exec(`CREATE TABLE IF NOT EXISTS _migrations (
    version INTEGER PRIMARY KEY,
    applied_at TEXT DEFAULT (datetime('now'))
  )`);

  // Migration v2 — using try/catch as guard since SQLite has no ALTER IF NOT EXISTS
  try { db.exec(`ALTER TABLE chunks ADD COLUMN parent_id TEXT REFERENCES chunks(id)`); } catch {}
  try { db.exec(`ALTER TABLE documents ADD COLUMN file_mtime TEXT`); } catch {}
  db.exec(`CREATE INDEX IF NOT EXISTS idx_doc_source ON documents(source_path, collection_id)`);
  db.exec(`CREATE TABLE IF NOT EXISTS watch_paths (
    id TEXT PRIMARY KEY,
    path TEXT NOT NULL,
    collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
    tags_json TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`);

  // Migration v3
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_collection_name ON collections(name)`);

  return db;
}

// ---------------------------------------------------------------------------
// Mock modules BEFORE importing route registrars
// ---------------------------------------------------------------------------

// Mock config
vi.mock("../../src/config.js", async () => {
  const { tmpdir } = await import("os");
  const { resolve } = await import("path");
  const { mkdirSync } = await import("fs");
  const dataDir = resolve(tmpdir(), "threadclaw-test-" + process.pid);
  mkdirSync(dataDir, { recursive: true });
  return { config: {
    port: 18800,
    dataDir,
    rootDir: dataDir,
    embedding: {
      url: "http://127.0.0.1:8012/v1",
      model: "BAAI/bge-large-en-v1.5",
      dimensions: 1024,
      prefixMode: "auto",
      batchSize: 32,
      similarityThreshold: 1.05,
    },
    reranker: {
      url: "http://127.0.0.1:8012",
      scoreThreshold: 0.0,
      disabled: false,
      topK: 20,
      smartSkip: true,
    },
    queryExpansion: { enabled: false, url: "", model: "" },
    watch: { paths: "", debounceMs: 3000 },
    defaults: {
      collection: "default",
      chunkMinTokens: 100,
      chunkMaxTokens: 1024,
      chunkTargetTokens: 512,
      queryTopK: 10,
      queryTokenBudget: 4000,
    },
    relations: {
      enabled: false,
      graphDbPath: resolve(dataDir, "graph.db"),
    },
    audio: { enabled: false, whisperModel: "base" },
  } };
});

// Mock storage/index — redirect getDb to our in-memory DB
vi.mock("../../src/storage/index.js", async (importOriginal) => {
  // Re-export the real collection functions (they take db as param)
  const real = await importOriginal<typeof import("../../src/storage/index.js")>();
  return {
    ...real,
    getDb: () => testDb,
    getMainDb: () => testDb,
    getInitializedDb: () => testDb,
    closeDb: () => {},
    runMigrations: () => {},
  };
});

// Mock the query pipeline
vi.mock("../../src/query/pipeline.js", () => ({
  query: vi.fn(async (queryText: string, opts: Record<string, unknown>) => {
    if (!queryText) return { error: "query required" };
    return {
      context: `Mock context for: ${queryText}`,
      sources: [],
      chunks: [],
      strategy: "mock",
      elapsed_ms: 1,
      confidence: 0.9,
      cached: false,
      topK: opts.topK ?? 10,
    };
  }),
}));

// Mock the ingest pipeline
vi.mock("../../src/ingest/pipeline.js", () => ({
  ingestFile: vi.fn(async (filePath: string, _opts?: Record<string, unknown>) => {
    return {
      documentId: "mock-doc-id",
      chunks: 5,
      tokens: 1000,
      collection: "default",
      path: filePath,
    };
  }),
}));

// Mock query cache
vi.mock("../../src/query/cache.js", () => ({
  invalidateCollection: vi.fn(),
  clearCache: vi.fn(),
  cacheKey: vi.fn((...args: string[]) => args.join("|")),
  getCached: vi.fn(() => null),
  setCached: vi.fn(),
}));

// Mock logger
vi.mock("../../src/utils/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    child: vi.fn(() => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    })),
  },
}));

// Mock token tracker
vi.mock("../../src/utils/token-tracker.js", () => ({
  getTokenCounts: vi.fn(() => ({ ingest: 0, embed: 0, rerank: 0, queryExpansion: 0 })),
  trackTokens: vi.fn(),
  flushTokens: vi.fn(),
}));

// Mock sources
vi.mock("../../src/sources/index.js", () => ({
  startSources: vi.fn(async () => {}),
  stopSources: vi.fn(async () => {}),
  getSourceEntries: vi.fn(() => []),
}));

// Mock graph storage (used by diagnostics route)
vi.mock("../../src/storage/graph-sqlite.js", () => ({
  getGraphDb: vi.fn(() => null),
}));

// ---------------------------------------------------------------------------
// Import route registrars (after mocks are set up)
// ---------------------------------------------------------------------------

import { registerHealthRoutes } from "../../src/api/health.routes.js";
import { registerCollectionRoutes } from "../../src/api/collection.routes.js";
import { registerQueryRoutes } from "../../src/api/query.routes.js";
import { registerIngestRoutes } from "../../src/api/ingest.routes.js";
import { registerAnalyticsRoutes } from "../../src/api/analytics.routes.js";
import { registerSourceRoutes } from "../../src/api/sources.routes.js";
import { registerRateLimit } from "../../src/api/ratelimit.js";
import { registerGraphObjectRoutes } from "../../src/api/graph-objects.routes.js";
import { getGraphDb } from "../../src/storage/graph-sqlite.js";

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------

let app: FastifyInstance;

beforeAll(async () => {
  testDb = createTestDb();

  app = Fastify({ logger: false });

  // Register rate limiting (before routes, matching server.ts order)
  registerRateLimit(app);

  // Register all routes
  registerHealthRoutes(app);
  registerCollectionRoutes(app);
  registerQueryRoutes(app);
  registerIngestRoutes(app);
  registerAnalyticsRoutes(app);
  registerSourceRoutes(app);
  registerGraphObjectRoutes(app);

  await app.ready();
});

afterAll(async () => {
  await app.close();
  testDb.close();
});

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------

describe("Health", () => {
  it("GET /health returns 503 degraded when embedding server is not running", async () => {
    const res = await app.inject({ method: "GET", url: "/health" });
    // In test env, embedding server is not running so we expect 503/degraded.
    // If this starts returning 200, the mock setup changed and this test should be updated.
    expect(res.statusCode).toBe(503);
    const body = res.json();
    expect(body).toHaveProperty("status");
    expect(body).toHaveProperty("services");
    expect(body.status).toBe("degraded");
  });

  it("GET /stats returns 200 with stats object", async () => {
    const res = await app.inject({ method: "GET", url: "/stats" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveProperty("collections");
    expect(body).toHaveProperty("documents");
    expect(body).toHaveProperty("chunks");
    expect(body).toHaveProperty("tokens");
    expect(body).toHaveProperty("dbSizeMB");
    expect(typeof body.collections).toBe("number");
  });
});

// ---------------------------------------------------------------------------
// Collections
// ---------------------------------------------------------------------------

describe("Collections", () => {
  // Clean up collections between tests
  beforeEach(() => {
    testDb.exec("DELETE FROM collections");
  });

  it("GET /collections returns empty array initially", async () => {
    const res = await app.inject({ method: "GET", url: "/collections" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveProperty("collections");
    expect(body.collections).toEqual([]);
  });

  it("POST /collections creates a collection, returns 201", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/collections",
      payload: { name: "test-collection", description: "A test collection" },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body).toHaveProperty("id");
    expect(body.name).toBe("test-collection");
    expect(body.description).toBe("A test collection");
    expect(body).toHaveProperty("created_at");
  });

  it("POST /collections with same name returns 409", async () => {
    // Create first
    await app.inject({
      method: "POST",
      url: "/collections",
      payload: { name: "duplicate-test" },
    });

    // Attempt duplicate
    const res = await app.inject({
      method: "POST",
      url: "/collections",
      payload: { name: "duplicate-test" },
    });
    expect(res.statusCode).toBe(409);
    const body = res.json();
    expect(body.error).toContain("already exists");
  });

  it("POST /collections without name returns 400", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/collections",
      payload: {},
    });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error).toContain("name required");
  });

  it("DELETE /collections/:id returns 200", async () => {
    // Create a collection first
    const createRes = await app.inject({
      method: "POST",
      url: "/collections",
      payload: { name: "to-delete" },
    });
    const { id } = createRes.json();

    const res = await app.inject({
      method: "DELETE",
      url: `/collections/${id}`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.deleted).toBe(true);

    // Verify it's gone
    const listRes = await app.inject({ method: "GET", url: "/collections" });
    expect(listRes.json().collections).toEqual([]);
  });

  it("GET /collections/:id/stats returns stats for existing collection", async () => {
    const createRes = await app.inject({
      method: "POST",
      url: "/collections",
      payload: { name: "stats-test" },
    });
    const { id } = createRes.json();

    const res = await app.inject({
      method: "GET",
      url: `/collections/${id}/stats`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.id).toBe(id);
    expect(body.name).toBe("stats-test");
    expect(body).toHaveProperty("documentCount");
    expect(body).toHaveProperty("chunkCount");
    expect(body).toHaveProperty("totalTokens");
    expect(body.documentCount).toBe(0);
  });

  it("GET /collections/:id/stats returns 404 for nonexistent collection", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/collections/nonexistent-id/stats",
    });
    expect(res.statusCode).toBe(404);
    const body = res.json();
    expect(body.error).toContain("not found");
  });
});

// ---------------------------------------------------------------------------
// Query
// ---------------------------------------------------------------------------

describe("Query", () => {
  it("POST /query with empty query returns error", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/query",
      payload: { query: "" },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error).toBe("Invalid query (max 2000 characters)");
  });

  it("POST /query with valid query returns results", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/query",
      payload: { query: "test query" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveProperty("context");
    expect(body.context).toContain("test query");
    expect(body).toHaveProperty("strategy");
  });

  it("POST /query passes clamped top_k to pipeline", async () => {
    const { query: mockQuery } = await import("../../src/query/pipeline.js");

    const res = await app.inject({
      method: "POST",
      url: "/query",
      payload: { query: "clamping test", top_k: 500 },
    });
    expect(res.statusCode).toBe(200);

    // The mock was called with topK clamped to 100
    expect(mockQuery).toHaveBeenCalledWith(
      "clamping test",
      expect.objectContaining({ topK: 100 }),
    );
  });

  it("POST /search with empty query returns error", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/search",
      payload: { query: "" },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error).toBe("Invalid query (max 2000 characters)");
  });

  it("POST /search with valid query returns results", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/search",
      payload: { query: "search test" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveProperty("context");
  });
});

// ---------------------------------------------------------------------------
// Ingest
// ---------------------------------------------------------------------------

describe("Ingest", () => {
  it("POST /ingest without path returns 400", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/ingest",
      payload: {},
    });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error).toContain("path");
  });

  it("POST /ingest with nonexistent path returns 400", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/ingest",
      payload: { path: "/nonexistent/file/that/does/not/exist.txt" },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error).toContain("File not found");
  });

  it("POST /ingest/text without text returns 400", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/ingest/text",
      payload: {},
    });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error).toContain("text required");
  });

  it("POST /ingest/text with valid text returns 200", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/ingest/text",
      payload: { text: "Hello world, this is a test document.", title: "Test Doc" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveProperty("documentId");
    expect(body).toHaveProperty("chunks");
  });
});

// ---------------------------------------------------------------------------
// Analytics
// ---------------------------------------------------------------------------

describe("Analytics", () => {
  it("GET /analytics returns analytics object", async () => {
    const res = await app.inject({ method: "GET", url: "/analytics" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    // With no queries recorded, expect the empty state
    expect(body).toHaveProperty("total");
    expect(body.total).toBe(0);
  });

  it("GET /analytics/recent returns array", async () => {
    const res = await app.inject({ method: "GET", url: "/analytics/recent" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveProperty("queries");
    expect(Array.isArray(body.queries)).toBe(true);
  });

  it("DELETE /analytics clears data and returns confirmation", async () => {
    const res = await app.inject({ method: "DELETE", url: "/analytics", payload: { confirm: true } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.cleared).toBe(true);
  });

  it("GET /analytics/awareness returns awareness stats or fallback", async () => {
    const res = await app.inject({ method: "GET", url: "/analytics/awareness" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    // Without awareness module, should return fallback
    expect(body).toHaveProperty("totalTurns");
    expect(body).toHaveProperty("firedCount");
  });
});

// ---------------------------------------------------------------------------
// Sources
// ---------------------------------------------------------------------------

describe("Sources", () => {
  it("GET /sources returns sources array", async () => {
    const res = await app.inject({ method: "GET", url: "/sources" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveProperty("sources");
    expect(Array.isArray(body.sources)).toBe(true);
  });

  it("POST /sources/reload returns status", async () => {
    const res = await app.inject({ method: "POST", url: "/sources/reload" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe("ok");
  });
});

// ---------------------------------------------------------------------------
// Rate Limiting
// ---------------------------------------------------------------------------

describe("Rate Limiting", () => {
  it("rate limit headers are present on non-health responses", async () => {
    const res = await app.inject({ method: "GET", url: "/collections" });
    expect(res.statusCode).toBe(200);
    // Rate limit headers should be set by the preHandler hook
    expect(res.headers["x-ratelimit-limit"]).toBeDefined();
    expect(res.headers["x-ratelimit-remaining"]).toBeDefined();
  });

  it("health endpoint is exempt from rate limiting", async () => {
    const res = await app.inject({ method: "GET", url: "/health" });
    // 200 when healthy, 503 when degraded — either is fine for rate limit test
    expect([200, 503]).toContain(res.statusCode);
    // Health checks should NOT have rate limit headers
    // (the preHandler returns early for /health)
    expect(res.headers["x-ratelimit-limit"]).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Route registration (basic 404 for unknown routes)
// ---------------------------------------------------------------------------

describe("Route Registration", () => {
  it("unknown routes return 404", async () => {
    const res = await app.inject({ method: "GET", url: "/nonexistent" });
    expect(res.statusCode).toBe(404);
  });

  it("wrong HTTP method returns 404", async () => {
    const res = await app.inject({ method: "PUT", url: "/health" });
    expect(res.statusCode).toBe(404);
  });

  // TODO: Add route registration tests for: document, event-stream, graph, reindex, reset
  // These routes exist in the codebase but are not yet covered by tests.
});

// ---------------------------------------------------------------------------
// Missing coverage TODOs
// ---------------------------------------------------------------------------

// TODO: Test guards module (src/api/guards.ts) — API key auth, path traversal checks

describe("Query edge cases", () => {
  it("POST /query rejects queries over 2000 characters", async () => {
    const longQuery = "a".repeat(2001);
    const res = await app.inject({
      method: "POST",
      url: "/query",
      payload: { query: longQuery },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain("max 2000");
  });
});

describe("Collection edge cases", () => {
  it("DELETE /collections/:nonexistent returns 404", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: "/collections/does-not-exist-id",
    });
    expect(res.statusCode).toBe(404);
  });
});

describe("Content-Type", () => {
  it("JSON responses have application/json content-type", async () => {
    const res = await app.inject({ method: "GET", url: "/collections" });
    expect(res.headers["content-type"]).toContain("application/json");
  });
});

// ---------------------------------------------------------------------------
// Graph Object Routes
// ---------------------------------------------------------------------------

describe("Graph Object Routes", () => {
  let graphDb: Database.Database;

  /**
   * Create an in-memory SQLite DB with the memory_objects + provenance_links
   * schema, and point the getGraphDb mock at it for all graph route tests.
   */
  beforeAll(() => {
    graphDb = new Database(":memory:");
    graphDb.pragma("journal_mode = WAL");
    graphDb.pragma("foreign_keys = ON");

    graphDb.exec(`
      CREATE TABLE IF NOT EXISTS memory_objects (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        composite_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        canonical_key TEXT,
        content TEXT NOT NULL,
        structured_json TEXT,
        scope_id INTEGER NOT NULL DEFAULT 1,
        branch_id INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'active',
        confidence REAL NOT NULL DEFAULT 0.5,
        trust_score REAL NOT NULL DEFAULT 0.5,
        influence_weight TEXT DEFAULT 'standard',
        superseded_by TEXT,
        source_kind TEXT,
        source_id TEXT,
        source_detail TEXT,
        source_authority REAL DEFAULT 0.5,
        first_observed_at TEXT,
        last_observed_at TEXT,
        observed_at TEXT,
        extraction_method TEXT,
        provisional INTEGER DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now')),
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now'))
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_mo_composite ON memory_objects(composite_id);
      CREATE INDEX IF NOT EXISTS idx_mo_kind_status ON memory_objects(kind, status, scope_id);
    `);

    graphDb.exec(`
      CREATE TABLE IF NOT EXISTS provenance_links (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        subject_id TEXT NOT NULL,
        predicate TEXT NOT NULL CHECK(predicate IN (
          'derived_from', 'supports', 'contradicts', 'supersedes',
          'mentioned_in', 'relates_to', 'resolved_by', 'about'
        )),
        object_id TEXT NOT NULL,
        confidence REAL NOT NULL DEFAULT 1.0,
        detail TEXT,
        scope_id INTEGER DEFAULT 1,
        metadata TEXT,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now')),
        UNIQUE(subject_id, predicate, object_id)
      );
    `);

    // Point getGraphDb mock to the in-memory graph DB
    vi.mocked(getGraphDb).mockReturnValue(graphDb);
  });

  afterAll(() => {
    // Restore getGraphDb to its default (null)
    vi.mocked(getGraphDb).mockReturnValue(null as any);
    graphDb.close();
  });

  beforeEach(() => {
    graphDb.exec("DELETE FROM provenance_links");
    graphDb.exec("DELETE FROM memory_objects");
  });

  // Helper to insert a memory object
  function insertObj(fields: {
    composite_id: string;
    kind: string;
    content: string;
    structured_json?: string;
    status?: string;
    confidence?: number;
    last_observed_at?: string;
    created_at?: string;
    updated_at?: string;
  }): number {
    const stmt = graphDb.prepare(`
      INSERT INTO memory_objects
        (composite_id, kind, content, structured_json, status, confidence, last_observed_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const now = new Date().toISOString();
    const info = stmt.run(
      fields.composite_id,
      fields.kind,
      fields.content,
      fields.structured_json ?? "{}",
      fields.status ?? "active",
      fields.confidence ?? 0.5,
      fields.last_observed_at ?? now,
      fields.created_at ?? now,
      fields.updated_at ?? now,
    );
    return Number(info.lastInsertRowid);
  }

  // ── Claims ───────────────────────────────────────────────────────

  it("GET /graph/claims returns claims with correct fields", async () => {
    insertObj({
      composite_id: "claim-1",
      kind: "claim",
      content: "TypeScript is typed",
      structured_json: JSON.stringify({
        subject: "TypeScript",
        predicate: "is",
        objectText: "typed",
      }),
      status: "active",
      confidence: 0.9,
    });

    const res = await app.inject({ method: "GET", url: "/graph/claims" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveProperty("claims");
    expect(body).toHaveProperty("total", 1);
    expect(body).toHaveProperty("limit");
    expect(body).toHaveProperty("offset");
    expect(body.claims).toHaveLength(1);

    const claim = body.claims[0];
    expect(claim.subject).toBe("TypeScript");
    expect(claim.predicate).toBe("is");
    expect(claim.object).toBe("typed");
    expect(claim.confidence).toBe(0.9);
    expect(claim.status).toBe("active");
    expect(claim).toHaveProperty("scope_id");
    expect(claim).toHaveProperty("created_at");
    expect(claim).toHaveProperty("last_observed_at");
  });

  it("GET /graph/claims respects limit/offset pagination", async () => {
    for (let i = 0; i < 5; i++) {
      insertObj({
        composite_id: `claim-page-${i}`,
        kind: "claim",
        content: `Claim ${i}`,
        structured_json: JSON.stringify({ subject: `S${i}`, predicate: "p", objectText: `O${i}` }),
      });
    }

    const res = await app.inject({ method: "GET", url: "/graph/claims?limit=2&offset=1" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.total).toBe(5);
    expect(body.limit).toBe(2);
    expect(body.offset).toBe(1);
    expect(body.claims).toHaveLength(2);
  });

  it("GET /graph/claims filters by status", async () => {
    insertObj({
      composite_id: "claim-active-1",
      kind: "claim",
      content: "Active claim",
      status: "active",
    });
    insertObj({
      composite_id: "claim-retired-1",
      kind: "claim",
      content: "Retired claim",
      status: "retired",
    });

    const res = await app.inject({ method: "GET", url: "/graph/claims?status=retired" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.total).toBe(1);
    expect(body.claims).toHaveLength(1);
    expect(body.claims[0].status).toBe("retired");
  });

  // ── Decisions ────────────────────────────────────────────────────

  it("GET /graph/decisions returns decisions with correct fields", async () => {
    insertObj({
      composite_id: "decision-1",
      kind: "decision",
      content: "Use Fastify over Express",
      structured_json: JSON.stringify({
        topic: "Web Framework",
        decisionText: "Use Fastify over Express for performance",
      }),
      confidence: 0.85,
    });

    const res = await app.inject({ method: "GET", url: "/graph/decisions" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveProperty("decisions");
    expect(body).toHaveProperty("total", 1);
    expect(body.decisions).toHaveLength(1);

    const decision = body.decisions[0];
    expect(decision.topic).toBe("Web Framework");
    expect(decision.decision_text).toBe("Use Fastify over Express for performance");
    expect(decision).toHaveProperty("content");
    expect(decision).toHaveProperty("scope_id");
    expect(decision).toHaveProperty("confidence");
    expect(decision).toHaveProperty("status");
  });

  // ── Loops ────────────────────────────────────────────────────────

  it("GET /graph/loops returns loops with correct fields", async () => {
    insertObj({
      composite_id: "loop-1",
      kind: "loop",
      content: "Waiting for CI results",
      structured_json: JSON.stringify({
        loopType: "blocker",
        text: "CI pipeline is running",
        owner: "Wesley",
        priority: "high",
        waitingOn: "GitHub Actions",
      }),
      status: "active",
    });

    const res = await app.inject({ method: "GET", url: "/graph/loops" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveProperty("loops");
    expect(body).toHaveProperty("total", 1);
    expect(body.loops).toHaveLength(1);

    const loop = body.loops[0];
    expect(loop.loop_type).toBe("blocker");
    expect(loop.text).toBe("CI pipeline is running");
    expect(loop.owner).toBe("Wesley");
    expect(loop).toHaveProperty("priority");
    expect(loop).toHaveProperty("waiting_on");
    expect(loop).toHaveProperty("status");
    expect(loop).toHaveProperty("confidence");
  });

  // ── Conflicts ────────────────────────────────────────────────────

  it("GET /graph/conflicts returns conflicts with correct fields", async () => {
    insertObj({
      composite_id: "conflict-1",
      kind: "conflict",
      content: "Contradicting claims about deployment target",
      structured_json: JSON.stringify({
        objectIdA: "claim-a",
        objectIdB: "claim-b",
        canonicalKey: "deployment_target",
      }),
      status: "active",
    });

    const res = await app.inject({ method: "GET", url: "/graph/conflicts" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveProperty("conflicts");
    expect(body).toHaveProperty("total", 1);
    expect(body.conflicts).toHaveLength(1);

    const conflict = body.conflicts[0];
    expect(conflict.object_id_a).toBe("claim-a");
    expect(conflict.object_id_b).toBe("claim-b");
    expect(conflict).toHaveProperty("canonical_key");
    expect(conflict).toHaveProperty("content");
    expect(conflict).toHaveProperty("status");
    expect(conflict).toHaveProperty("confidence");
  });

  // ── Procedures ───────────────────────────────────────────────────

  it("GET /graph/procedures returns procedures with kind='procedure'", async () => {
    insertObj({
      composite_id: "proc-runbook-1",
      kind: "procedure",
      content: "How to deploy",
      structured_json: JSON.stringify({
        toolName: "deploy-tool",
        key: "deploy-steps",
        isNegative: 0,
      }),
    });
    insertObj({
      composite_id: "proc-anti-1",
      kind: "procedure",
      content: "Never force push to main",
      structured_json: JSON.stringify({
        toolName: "git-tool",
        key: "no-force-push",
        isNegative: 1,
      }),
    });

    const res = await app.inject({ method: "GET", url: "/graph/procedures" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveProperty("procedures");
    expect(body).toHaveProperty("total", 2);
    expect(body.procedures).toHaveLength(2);

    const proc = body.procedures[0];
    expect(proc).toHaveProperty("tool_name");
    expect(proc).toHaveProperty("key");
    expect(proc).toHaveProperty("is_negative");
    expect(proc).toHaveProperty("content");
    expect(proc).toHaveProperty("status");
  });

  it("GET /graph/procedures?type=anti_runbook filters by isNegative", async () => {
    insertObj({
      composite_id: "proc-rb-1",
      kind: "procedure",
      content: "How to deploy",
      structured_json: JSON.stringify({ toolName: "deploy", key: "deploy", isNegative: 0 }),
    });
    insertObj({
      composite_id: "proc-arb-1",
      kind: "procedure",
      content: "Never do this",
      structured_json: JSON.stringify({ toolName: "git", key: "no-force", isNegative: 1 }),
    });

    const res = await app.inject({ method: "GET", url: "/graph/procedures?type=anti_runbook" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.total).toBe(1);
    expect(body.procedures).toHaveLength(1);
    expect(body.procedures[0].is_negative).toBe(1);
  });

  // ── Truth Health ─────────────────────────────────────────────────

  it("GET /graph/truth-health returns recentlyChanged, lowConfidence, unresolvedConflicts", async () => {
    // Low confidence claim
    insertObj({
      composite_id: "low-conf-1",
      kind: "claim",
      content: "Uncertain claim",
      structured_json: JSON.stringify({ subject: "X", predicate: "might be", objectText: "Y" }),
      confidence: 0.2,
      status: "active",
    });

    // Unresolved conflict
    insertObj({
      composite_id: "conflict-health-1",
      kind: "conflict",
      content: "Unresolved conflict",
      status: "active",
    });

    // Recently changed (updated_at != created_at)
    const past = "2025-01-01T00:00:00.000";
    const now = new Date().toISOString();
    insertObj({
      composite_id: "changed-1",
      kind: "claim",
      content: "Changed claim",
      status: "active",
      created_at: past,
      updated_at: now,
    });

    const res = await app.inject({ method: "GET", url: "/graph/truth-health" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveProperty("recentlyChanged");
    expect(body).toHaveProperty("lowConfidence");
    expect(body).toHaveProperty("unresolvedConflicts");
    expect(Array.isArray(body.recentlyChanged)).toBe(true);
    expect(Array.isArray(body.lowConfidence)).toBe(true);
    expect(Array.isArray(body.unresolvedConflicts)).toBe(true);
    expect(body.lowConfidence.length).toBeGreaterThanOrEqual(1);
    expect(body.unresolvedConflicts.length).toBeGreaterThanOrEqual(1);
    expect(body.recentlyChanged.length).toBeGreaterThanOrEqual(1);
  });

  // ── Timeline ─────────────────────────────────────────────────────

  it("GET /graph/timeline returns events with subject filter", async () => {
    insertObj({
      composite_id: "timeline-1",
      kind: "claim",
      content: "Fastify is fast",
      structured_json: JSON.stringify({ subject: "Fastify" }),
      status: "active",
    });
    insertObj({
      composite_id: "timeline-2",
      kind: "claim",
      content: "Express is popular",
      structured_json: JSON.stringify({ subject: "Express" }),
      status: "active",
    });

    const res = await app.inject({ method: "GET", url: "/graph/timeline?subject=Fastify" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveProperty("events");
    expect(body).toHaveProperty("supersessions");
    expect(body).toHaveProperty("subjectNormalized", "fastify");
    expect(Array.isArray(body.events)).toBe(true);
    expect(body.events.length).toBeGreaterThanOrEqual(1);

    // All returned events should relate to "Fastify"
    for (const event of body.events) {
      expect(event).toHaveProperty("id");
      expect(event).toHaveProperty("composite_id");
      expect(event).toHaveProperty("kind");
      expect(event).toHaveProperty("content");
      expect(event).toHaveProperty("confidence");
      expect(event).toHaveProperty("status");
      expect(event).toHaveProperty("created_at");
    }
  });
});
