# Migration Guide

## Upgrading from RSMA-Only Setup

If you were using ClawCore before the Evidence OS, upgrading is automatic:

1. Update to the latest version
2. Evidence graph DB is created on first startup (new file, doesn't affect existing data)
3. All 6 schema migrations run idempotently
4. Existing RSMA functionality (search, ingest, memory) is unaffected

## Enabling Evidence Features

Evidence OS features are **all opt-in**. Enable progressively:

### Phase 1: Entity Awareness
```bash
CLAWCORE_MEMORY_RELATIONS_ENABLED=true
CLAWCORE_MEMORY_RELATIONS_AWARENESS_ENABLED=true
```

### Phase 2: Claims & Context Compilation
```bash
CLAWCORE_MEMORY_RELATIONS_CLAIM_EXTRACTION_ENABLED=true
CLAWCORE_MEMORY_RELATIONS_CONTEXT_TIER=standard
```

### Phase 3: Attempt Tracking
```bash
CLAWCORE_MEMORY_RELATIONS_ATTEMPT_TRACKING_ENABLED=true
```

### Phase 4: Deep Extraction (Optional)
```bash
CLAWCORE_MEMORY_RELATIONS_DEEP_EXTRACTION_ENABLED=true
CLAWCORE_MEMORY_RELATIONS_DEEP_EXTRACTION_MODEL=claude-sonnet-4-20250514
CLAWCORE_MEMORY_RELATIONS_DEEP_EXTRACTION_PROVIDER=anthropic
```

### Phase 5: Extraction Mode (Optional)
```bash
# Smart: LLM-based semantic extraction (default when deep extraction is enabled)
# Understands natural language without magic prefixes.
CLAWCORE_MEMORY_RELATIONS_EXTRACTION_MODE=smart

# Fast: Regex-only, no LLM calls, <5ms (default when no model configured)
CLAWCORE_MEMORY_RELATIONS_EXTRACTION_MODE=fast
```

Smart mode uses the same model as deep extraction — no extra model to configure. If deep extraction is enabled and extraction mode is not explicitly set, smart mode is used automatically.

## Schema Migrations

Migrations are tracked in `_evidence_migrations` table and run idempotently:

| Version | Horizon | Tables Added |
|---------|---------|-------------|
| v1 | Infrastructure + H1 | evidence_log, scopes, branches, policies, entities, mentions |
| v2 | H2 | claims, claim_evidence, decisions, loops, deltas, capabilities, invariants |
| v3 | H3 | attempts, runbooks, anti_runbooks |
| v4 | H3 | work_leases |
| v5 | H4 | runbook_evidence |
| v6 | H5 | entity_relations |
| v7 | H5 | anti_runbook_evidence |
| v8-v9 | H5 | Indexes and constraints |
| v10 | RSMA | provenance_links (unified, replaces 7 legacy join tables) |

## Renamed Concepts

| Old Name | New Name |
|----------|----------|
| lossless-claw | clawcore-memory |
| LCM | ClawCore Memory Engine |
| RSMA | ClawCore (broader scope) |

## Rollback

```bash
# Disable all evidence features (keeps RSMA working)
CLAWCORE_MEMORY_RELATIONS_ENABLED=false

# Remove evidence data entirely
rm ~/.clawcore/data/graph.db
```

No schema downgrade is needed — disabling the feature flag stops all evidence operations.
