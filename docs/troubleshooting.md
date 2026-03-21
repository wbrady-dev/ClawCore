# Troubleshooting

## First Step: Run Doctor

Before debugging manually, run the diagnostic tool:

```bash
clawcore doctor
```

This checks versions, data integrity, OpenClaw integration, services, skills, and compatibility in one pass. It will tell you exactly what's wrong and how to fix it.

Other useful commands:
- `clawcore doctor --json` — machine-readable output
- `clawcore integrate --check` — check OpenClaw integration only
- `clawcore upgrade` — fix version/migration issues

## Database Issues

### "database is locked"
**Cause**: Multiple processes writing to the same SQLite file simultaneously.
**Fix**: ClawCore uses WAL mode with `busy_timeout=5000ms`. If still occurring:
- Ensure only one ClawCore process runs per database
- Check for zombie processes: `ps aux | grep clawcore`
- The evidence graph DB supports concurrent reads via WAL mode

### "no such table" errors
**Cause**: Schema migrations didn't run.
**Fix**: Migrations run automatically on startup. If manual fix needed:
- Delete the database file and restart (data will be lost)
- Or run the migration manually via the engine's `runGraphMigrations()` function

### Database corruption
**Fix**:
```bash
# Memory engine
rm ~/.clawcore/data/memory.db
# Evidence graph
rm ~/.clawcore/data/graph.db
# Document store
rm ~/.clawcore/data/clawcore.db
```
All databases rebuild automatically on next startup.

## Evidence Graph Issues

### Awareness notes not appearing
**Check**:
1. `CLAWCORE_MEMORY_RELATIONS_ENABLED=true`
2. `CLAWCORE_MEMORY_RELATIONS_AWARENESS_ENABLED=true`
3. Entities must have `mention_count >= RELATIONS_MIN_MENTIONS` (default: 2)
4. Entity cache rebuilds every 30 seconds — new entities may take up to 30s to appear

### Claims not being extracted
**Check**:
1. `CLAWCORE_MEMORY_RELATIONS_CLAIM_EXTRACTION_ENABLED=true`
2. Claims are extracted during compaction (after conversation summarization)
3. Fast extraction only works with structured signals: "Remember:", heading+bullets, YAML frontmatter, tool results

### Anti-runbooks not decaying
Decay is applied **lazily** — only when anti-runbooks are queried (via `cc_antirunbooks` tool or context compiler). Decay won't happen until something reads the data.

### cc_ask returns "Deep extraction is not enabled"
Set `CLAWCORE_MEMORY_RELATIONS_DEEP_EXTRACTION_ENABLED=true` and configure a model:
```bash
CLAWCORE_MEMORY_RELATIONS_DEEP_EXTRACTION_MODEL=claude-sonnet-4-20250514
CLAWCORE_MEMORY_RELATIONS_DEEP_EXTRACTION_PROVIDER=anthropic
```

## Search Issues

### Zero results
- Check collection exists: `clawcore collections list`
- Check embedding server is running: `curl http://127.0.0.1:8012/health`
- Try broader query terms

### Low confidence scores
- Enable reranking (enabled by default)
- Try query expansion: `QUERY_EXPANSION_ENABLED=true`
- Entity-boosted search activates for 1-2 word queries when relations are enabled

## Performance

### Slow search
- Check reranker is running locally (not cloud)
- Use `--brief` mode for faster responses
- Entity cache rebuilds every 30s (first awareness query may be slower)

### High memory usage
- Evidence graph entity cache is capped at 5,000 entries
- Awareness eval ring buffer is capped at 2,000 events
- Context compiler uses token budgets (110-280 tokens)

## Rollback

```bash
# Disable evidence OS features (keeps CRAM)
CLAWCORE_MEMORY_RELATIONS_ENABLED=false

# Delete evidence data only
rm ~/.clawcore/data/graph.db

# Full reset
rm ~/.clawcore/data/memory.db
rm ~/.clawcore/data/graph.db
rm ~/.clawcore/data/clawcore.db
```

## OpenClaw Integration Issues

### "plugins.allow is empty; discovered non-bundled plugins may auto-load"
**Cause**: OpenClaw doesn't have `clawcore-memory` in its trusted plugin list.
**Fix**: Run `clawcore integrate --apply` to set `plugins.allow` automatically.

### Evidence tools not showing up (cc_state, cc_claims, etc.)
**Cause**: The graph database isn't at the expected path, so `graphDb` is null and evidence tools don't register.
**Fix**:
1. Run `clawcore doctor` to check data paths
2. Run `clawcore upgrade` to consolidate data to `~/.clawcore/data/`
3. Restart OpenClaw services

### Integration drift after OpenClaw update
**Cause**: OpenClaw update reset plugin configuration.
**Fix**: Run `clawcore integrate --check` to see what drifted, then `clawcore integrate --apply` to fix.
