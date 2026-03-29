# Observability

## Metrics

### Query Analytics
- `GET /analytics` — Aggregate search stats, low-confidence queries, zero-result queries, slow queries
- `GET /analytics/recent?limit=N` — Last N queries with full details
- Ring buffer: 500 entries, resets on restart

### Awareness Analytics
- `GET /analytics/awareness` — Fire rate, latency percentiles, token overhead, note type breakdown
- Ring buffer: 2,000 events, resets on restart
- Access via `getAwarenessStats(windowMs)` function

## Logs

### Memory Engine
```
[cc-mem] Plugin loaded (enabled=true, db=..., threshold=0.75)
[cc-mem] Failed to initialize evidence graph DB: ...
```

### Evidence Operations
Every evidence mutation is logged to `evidence_log` with:
- `actor`: Who performed the operation
- `run_id`: Execution trace identifier
- `created_at`: Millisecond-precision timestamp
- `scope_seq`: Scope-local sequence number

#### Event Types
| event_type | Description |
|------------|-------------|
| `claim_insert` | New claim written |
| `claim_supersede` | Claim superseded by newer version |
| `decision_insert` | New decision written |
| `mention_insert` | Entity mention recorded |
| `invariant_violation` | Write-time invariant enforcement triggered. Payload contains the violation details (invariant key, description, severity, match reason) and a truncated content preview. The violating object is set to `needs_confirmation` status. |
| `reset` | Full graph data reset |

## Health Checks

### Database Health
```typescript
// Connection health check (built into pool)
function isConnectionHealthy(db): boolean {
  db.prepare("SELECT 1").get();
  return true;
}
```

### Evidence Graph Status
```bash
# Via CLI
threadclaw relations stats
# Shows: entity count, mention count, evidence log events, top entities
```

## Key Performance Indicators

| KPI | Target | How to Monitor |
|-----|--------|----------------|
| Awareness fire rate | 10-20% | `getAwarenessStats().fireRate` |
| Awareness latency p95 | < 50ms | `getAwarenessStats().latencyP95` |
| Context compilation | < 10ms | Evidence log timestamps |
| Entity extraction | < 5ms/chunk | Timing in compaction logs |
| Search confidence | > 0.5 avg | `/analytics` endpoint |

## Stale Detection

- **Entities** (kind='entity' in memory_objects): `last_observed_at` tracked per entity; awareness queries flag stale references
- **Anti-runbooks** (kind='procedure', isNegative=true): Lazy decay marks items as `needs_confirmation` when confidence drops below 0.2
- **Runbooks** (kind='procedure', isNegative=false): Marked `stale` if unused for 180 days
- **Leases**: `cleanExpiredLeases()` removes expired leases lazily
