# Release Process

## Pre-Release Checklist

1. All tests pass: `npx vitest run` in both clawcore (89 tests) and memory-engine (858 tests)
2. Type check clean: `npx tsc --noEmit` (no new errors)
3. No stale references: `grep -r "lossless-claw" src/`
4. Distribution synced: All source files, tests, and configs match
5. `.env.example` updated with any new config variables
6. Documentation updated for new features

## Schema Migration Timing

- Migrations run automatically on startup (idempotent)
- New tables use `CREATE TABLE IF NOT EXISTS`
- Migration version tracked in `_evidence_migrations`
- No manual migration steps needed for users

## Changelog Rules

- Group by horizon (H1-H5) for evidence features
- List new tools, config options, and breaking changes
- Include migration version if schema changed

## Rollback Policy

All evidence features are opt-in via config flags:
```bash
CLAWCORE_MEMORY_RELATIONS_ENABLED=false  # Disables everything
```

Database rollback:
```bash
rm ~/.clawcore/data/graph.db  # Delete evidence data
# Schema recreates on next startup
```

No code rollback needed — disabling the flag stops all evidence operations.

## Feature Flags

| Flag | Default | Feature |
|------|---------|---------|
| relationsEnabled | false | All evidence features |
| relationsAwarenessEnabled | false | Awareness notes |
| relationsClaimExtractionEnabled | false | Claim extraction |
| relationsAttemptTrackingEnabled | false | Attempt ledger |
| relationsDeepExtractionEnabled | false | LLM deep extraction |

Progressive enablement is recommended: start with awareness, add claims, then attempts.

## Distribution

Distribution directory: `~/Documents/clawcore/`
- Must contain all source files, tests, and configs
- Must NOT contain `.env`, credentials, or personal data
- `.env.example` serves as the configuration template
