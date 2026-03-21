# Contributor Guide

## Project Structure

```
clawcore/
  src/              # Main ClawCore (HTTP server, CLI, TUI, ingest, query)
  memory-engine/    # Memory engine plugin (conversation memory + Evidence OS)
    src/
      relations/    # Evidence OS module (all 5 horizons)
      store/        # Conversation/summary stores
      db/           # Config, connection, migration
      tools/        # Memory engine tools (cc_grep, cc_describe, etc.)
    test/           # All tests
  docs/             # Documentation
```

## Development Setup

```bash
git clone https://github.com/openclaw/clawcore.git
cd clawcore && npm install
cd memory-engine && npm install
```

## Adding a New Evidence Store

Follow the existing pattern:

1. **Types** (`types.ts`): Add input/output interfaces
2. **Store** (new file): Implement CRUD with `logEvidence()` calls
3. **Schema** (`schema.ts`): Add migration if new table needed
4. **Tools** (`tools.ts`): Add tool factory function
5. **Exports** (`index.ts`): Export all public APIs
6. **Registration** (`memory-engine/index.ts`): Register tool in plugin
7. **Config** (`config.ts`): Add config fields if needed
8. **Tests**: Write tests with `:memory:` SQLite

## Key Patterns

- **SELECT-before-UPSERT**: For reliable `isNew` detection within transactions
- **logEvidence()**: Every mutation must log to the evidence log
- **withWriteTransaction()**: Wrap multi-step mutations for atomicity
- **Non-fatal try/catch**: Evidence operations never break core functionality
- **GraphDb interface**: Abstracts over both `node:sqlite` and `better-sqlite3`

## Running Tests

```bash
cd memory-engine
npx vitest run              # All tests
npx vitest run test/relations.test.ts  # Specific file
npx vitest --reporter=verbose  # Verbose output
```

## Style Rules

- TypeScript strict mode
- No `any` types in public APIs (internal `as unknown as GraphDb` casts are acceptable for SQLite type bridging)
- All SQL parameterized (no string interpolation)
- ORDER BY always includes `id DESC` tiebreaker for deterministic results
- Config defaults are always `false` for new features (opt-in)
