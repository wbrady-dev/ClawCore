# Performance

## Latency Budget

| Operation | Time | When |
|-----------|------|------|
| Entity extraction per chunk | ~3-5ms | Ingestion/compaction |
| Awareness graph queries | ~10-15ms | Every turn (if enabled) |
| Context capsule compilation | ~5-10ms | Every turn (if enabled) |
| Unseen doc fallback | ~50ms | Only when graph found nothing |
| Evidence total path | **< 50ms** | Every turn |
| Backfill per chunk | ~4-5ms | Once (CLI command) |
| Deep extraction (LLM) | 1-5s | Only on explicit tool call |

## Token Budget

| Component | Tokens | Frequency |
|-----------|--------|-----------|
| Awareness notes | 30-80 | ~10-20% of turns |
| Evidence capsules (Lite) | 0-110 | Every turn |
| Evidence capsules (Standard) | 0-190 | Every turn |
| Evidence capsules (Premium) | 0-280 | Every turn |

## SQLite Optimization

### WAL Mode
All databases use Write-Ahead Logging for concurrent read performance. Writers hold locks briefly via `BEGIN IMMEDIATE`.

### Busy Timeout
Set to 5000ms on the evidence graph DB, preventing immediate "database locked" errors under contention.

### Index Coverage
35 indexes across 22 tables, designed for actual query patterns:
- Scope+status composite indexes for filtered queries
- Temporal indexes for time-range queries
- FK indexes for JOIN performance

## Memory Usage

| Component | Limit | Size |
|-----------|-------|------|
| Entity name cache | 5,000 entries | ~200KB |
| Awareness eval buffer | 2,000 events | ~400KB |
| Query analytics buffer | 500 entries | ~100KB |
| Terms list cache | 500 terms | ~50KB |
| Total overhead | | ~750KB |

## Cross-Platform Notes

- **Windows**: No `chmod 600` — relies on user-profile ACLs
- **macOS/Linux**: File permissions set on evidence graph DB
- **Node 22+**: Required for `node:sqlite` DatabaseSync support
- **SQLite**: Both `node:sqlite` and `better-sqlite3` use WAL mode for the shared evidence graph
