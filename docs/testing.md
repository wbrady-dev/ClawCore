# Testing

## Test Framework

Vitest with in-memory SQLite databases for isolation. No external dependencies needed.

## Test Inventory

| File | Tests | Coverage |
|------|-------|----------|
| engine.test.ts | 54 | Core LCM engine, compaction, token budgets |
| expansion-auth.test.ts | 50 | Expansion auth, orchestrator, token caps |
| rsma-stress.test.ts | 49 | RSMA stress/load scenarios |
| relations.test.ts | 46 | H1: entities, extraction, evidence log, graph store, awareness, eval |
| lcm-integration.test.ts | 46 | LCM integration: compaction, durable parts |
| rsma-failure-injection.test.ts | 45 | RSMA failure injection resilience |
| relations-h2.test.ts | 34 | H2: claims, decisions, loops, deltas, capabilities, invariants |
| summarize.test.ts | 30 | Summarization, legacy params |
| relations-h3-promotion.test.ts | 25 | H3: leases, promotion policies, branch lifecycle |
| relations-h3.test.ts | 24 | H3: attempts, runbooks, anti-runbooks, decay |
| assembler-blocks.test.ts | 24 | Assembler block handling |
| relations-h4.test.ts | 16 | H4: runbook evidence, timeline, snapshots |
| relations-h2-compiler.test.ts | 15 | H2: context compiler, ROI governor, budget tiers |
| security-hardening.test.ts | 14 | Security regression guards (v0.2.1) |
| relations-h5.test.ts | 13 | H5: entity relations, deep extraction (mocked LLM) |
| fts5-sanitize.test.ts | 13 | FTS5 query sanitization |
| routes.test.ts | 28 | API route tests (health, collections, query, ingest, analytics, rate limiting) |
| parsers.test.ts | 39 | File parser tests (plaintext, markdown, CSV, JSON, code) + registry |
| chunker.test.ts | 14 | Chunking strategy tests (prose, markdown, merging, context prefix) |
| cli.test.ts | 8 | CLI command structure, subcommand registration, version/help output |
| + 15 other test files | 56 | Config, tools, expand, migration, fallback, etc. |
| **Total** | **1,197** | |

## Writing Tests

### Standard Pattern

```typescript
import { DatabaseSync } from "node:sqlite";

function createDb(): GraphDb {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  runGraphMigrations(db as unknown as GraphDb);
  return db as unknown as GraphDb;
}
```

### Mocking LLM Calls

For deep extraction tests, mock `deps.complete()`:
```typescript
const deps = {
  config: makeConfig({ relationsDeepExtractionEnabled: true }),
  complete: async () => ({ content: JSON.stringify([...]) }),
  resolveModel: () => ({ provider: "test", model: "test" }),
} as any;
```

### Testing Evidence Logging

Verify mutations create evidence log entries:
```typescript
const events = db.prepare(
  "SELECT * FROM evidence_log WHERE object_type = 'claim'"
).all();
expect(events.length).toBeGreaterThan(0);
```

## Running

```bash
npx vitest run                    # All tests
npx vitest run --reporter=verbose # Detailed output
npx vitest watch                  # Watch mode
npx tsc --noEmit                  # Type check only
```
