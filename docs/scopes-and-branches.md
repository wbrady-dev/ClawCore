# Scopes and Branches

## Scopes

Every piece of evidence belongs to a **scope** — a container representing a project, workspace, or conversation context. The global scope (id=1) is seeded automatically and used as the default.

Scopes enable multi-tenant isolation: entity A from project X won't leak into awareness queries for project Y.

### Scope Types
- `system` — Global/shared state
- `user` — User-level preferences
- `workspace` — Workspace-level knowledge
- `project` — Project-specific context
- `conversation` — Session-scoped

## Branches

Branches enable **speculative memory** — sub-agents can write claims, decisions, and other evidence to a branch without affecting shared state.

### Branch Types
- `shared` — Main scope state (branch_id=0)
- `run` — Agent execution run
- `subagent` — Sub-agent speculation
- `hypothesis` — Experimental theories

### Branch Lifecycle
1. **Create**: `createBranch(db, scopeId, "hypothesis", "redis-migration")`
2. **Write**: Store claims/decisions to the branch (branch_id = branch.id)
3. **Validate**: `checkPromotionPolicy(db, "claim", confidence, evidenceCount)`
4. **Promote**: `promoteBranch(db, branchId)` — merges to shared scope
5. **Or Discard**: `discardBranch(db, branchId)` — abandons speculation

### branch_id Sentinel
`branch_id=0` represents shared state (not a branch). This avoids SQLite's NULL uniqueness behavior — `NULL != NULL` in UNIQUE constraints would allow duplicate "shared" entries.

## Query Scoping

All query functions support optional branch awareness:
```
getActiveClaims(db, scopeId, branchId?)
```
- Without branchId: returns only shared state (branch_id=0)
- With branchId: returns shared + branch-specific state (`branch_id=0 OR branch_id=?`)
