# Agent Tools Reference

ClawCore provides 22 agent tools. 4 are always available (memory engine core), and 18 are available when `CLAWCORE_MEMORY_RELATIONS_ENABLED=true`. All tools are registered as OpenClaw plugin tools accessible by the agent during conversations.

## Memory Engine Tools (Always Available)

### cc_grep
Search conversation memory by pattern (regex or full-text).
- `pattern` (required): Search pattern
- `since`, `before`: Time range filters
- `conversationId`, `allConversations`, `crossAgent`: Scope controls

### cc_describe
Look up metadata for a memory item by ID (sum_xxx for summaries, file_xxx for files).
- `id` (required): Item ID
- `conversationId`, `allConversations`, `crossAgent`: Scope controls

### cc_expand
Expand compacted conversation summaries by traversing the summary DAG.
- `summaryIds` or `query`: What to expand
- `maxDepth`, `tokenCap`, `includeMessages`: Control expansion depth

### cc_recall
Ask a focused question against expanded conversation summaries.
- `query` (required): The question
- `conversationId`, `allConversations`: Scope controls

## Entity Awareness Tools (Horizon 1)

### cc_conflicts
List entities with possible context mismatches across sources.
- `entity`: Filter by entity name
- `limit`: Max results (default: 10)

## Stateful Evidence Tools (Horizon 2)

### cc_state
Show current knowledge state: active claims, decisions, and open loops.
- `scope_id`: Scope (default: 1 = global)
- `limit`: Max items per category

### cc_claims
List claims with evidence chains.
- `subject`: Filter by subject
- `scope_id`, `limit`: Scope and pagination

### cc_decisions
View active and historical decisions.
- `topic`: Filter by topic (shows full supersession history)
- `scope_id`, `include_superseded`: Controls

### cc_delta
Show recent state changes.
- `since`: ISO timestamp filter
- `scope_id`, `limit`: Controls

### cc_capabilities
List known tools, services, and systems.
- `type`: Filter by capability type
- `status`: Filter by status (available, unavailable, degraded)

### cc_invariants
List active constraints ordered by severity (critical first).
- `scope_id`: Scope filter

## Multi-Agent Durability Tools (Horizon 3)

### cc_loops
View open loops (tasks, questions, dependencies).
- `status`: Filter by status
- `scope_id`, `limit`: Controls

### cc_attempts
Show tool execution history with success rates.
- `tool_name`: Filter by tool (shows success rate when provided)
- `scope_id`, `limit`: Controls

### cc_antirunbooks
Show learned failure patterns to avoid repeating mistakes.
- `tool_name`: Filter by tool
- `scope_id`: Scope filter

### cc_branch
Manage speculative branches.
- `action`: `list` (default), `create`, `discard`
- `branch_type`, `branch_key`: For create
- `branch_id`: For discard

### cc_promote
Promote a branch to shared scope with policy validation.
- `branch_id` (required): Branch to promote
- `object_type`, `confidence`, `evidence_count`: Policy check params
- `user_confirmed`: Override user confirmation requirement

## Procedural Memory Tools (Horizon 4)

### cc_runbooks
List learned success patterns with evidence chains.
- `tool_name`: Filter by tool
- `runbook_id`: Get specific runbook with full evidence
- `scope_id`: Scope filter

### cc_timeline
Show the evidence event timeline.
- `since`, `before`: Time range
- `object_type`: Filter by type (claim, decision, branch, etc.)
- `scope_id`, `limit`: Controls

## Deep Extraction Tools (Horizon 5)

### cc_relate
Query entity relationships (requires entity graph data).
- `entity`: Entity name to query
- `predicate`: Filter by relationship type
- `scope_id`, `limit`: Controls

### cc_ask
Ask a question against the evidence store (requires `DEEP_EXTRACTION_ENABLED=true`).
- `question` (required): The question to answer
- `extract_claims`: Also extract claims from the question text
- `scope_id`: Scope filter

### cc_diagnostics
Show internal CRAM health: summary counts, claim counts, awareness stats, context compiler output, recent evidence events, and compaction state.
- `scope_id`: Scope ID (default: 1 = global)
- `verbose`: Include capsule text and recent events (default: false)

### cc_memory
Unified smart memory search — automatically searches claims, decisions, relationships, and conversation history. Routes internally based on query content.
- `query` (required): What to find or recall — a question, topic, name, or keyword
- `scope`: Optional: 'all' to search across all conversations (default: current)

## Tool Availability

- **Always available** (4): `cc_grep`, `cc_describe`, `cc_expand`, `cc_recall`
- **Requires `CLAWCORE_MEMORY_RELATIONS_ENABLED=true`** (18): All remaining tools
- **Additionally requires `DEEP_EXTRACTION_ENABLED=true`**: `cc_ask`

All tools handle empty results gracefully and wrap queries in try/catch for non-fatal error handling.
