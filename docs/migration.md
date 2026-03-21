# Migration Guide

## Upgrading from CRAM-Only Setup

If you were using ClawCore before the Evidence OS, upgrading is automatic:

1. Update to the latest version
2. Evidence graph DB is created on first startup (new file, doesn't affect existing data)
3. All 6 schema migrations run idempotently
4. Existing CRAM functionality (search, ingest, memory) is unaffected

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

## Renamed Concepts

| Old Name | New Name |
|----------|----------|
| lossless-claw | clawcore-memory |
| LCM | ClawCore Memory Engine |
| CRAM | ClawCore (broader scope) |

## Rollback

```bash
# Disable all evidence features (keeps CRAM working)
CLAWCORE_MEMORY_RELATIONS_ENABLED=false

# Remove evidence data entirely
rm ~/.clawcore/data/graph.db
```

No schema downgrade is needed — disabling the feature flag stops all evidence operations.
