# Core Concepts

## RSMA Architecture

> RSMA (Reconciled Semantic Memory Architecture) is a multi-layer agent architecture that combines retrieval, summary lineage, knowledge graphs, awareness, evidence-backed state, delta tracking, attempt memory, branch governance, and low-token context compilation.

`RSMA = RAG + DAG + KG + AL + SL + DE + AOM + BSG + EEL + CCL`

The layers work together: RAG provides the knowledge base, DAG tracks conversation lineage, KG builds entity graphs, AL surfaces context, SL manages claims/decisions/loops, DE tracks state changes, AOM records tool outcomes, BSG handles speculative branches, EEL provides the audit trail, and CCL compiles it all into a token-budgeted system prompt.

## ClawCore Evidence OS

The implementation of RSMA's stateful layers. Tracks structured knowledge extracted from conversations, documents, and tool results. Organized into 5 horizons:

### Entities & Awareness (Horizon 1)
**Entities** are named concepts extracted from text (people, tools, projects). ClawCore tracks where each entity appears, how often, and in what context. **Awareness notes** surface relevant entity information in the system prompt — mismatches across sources, stale references, and connections between entities.

### Claims & Decisions (Horizon 2)
**Claims** are structured facts: `subject predicate: object` (e.g., "Redis is: a cache"). Each claim has a confidence score, trust score, and evidence chain tracking where the claim came from. **Decisions** track active choices with automatic supersession — when a new decision on the same topic is made, the old one is marked superseded.

### Open Loops
**Loops** are pending items — tasks, questions, follow-ups, dependencies. They have priority, owner, due date, and status (open, blocked, closed). The context compiler surfaces high-priority loops.

### Invariants
**Invariants** are durable constraints that must be respected — "never force push to main", "always run tests before deploy". Ordered by severity (critical, error, warning, info).

### Capabilities
**Capabilities** track known tools, services, and systems with their current status (available, unavailable, degraded).

### State Deltas
**Deltas** record what changed, from what value to what value, and when. Provides a change log for the knowledge base.

### Attempts & Runbooks (Horizon 3)
**Attempts** record every tool execution with its outcome (success, failure, partial, timeout), duration, and error text. **Runbooks** are learned success patterns — when a tool succeeds repeatedly, ClawCore auto-infers a runbook. **Anti-runbooks** are the opposite: learned failure patterns surfaced as high-priority warnings.

### Branches & Promotion
**Branches** enable speculative memory — a sub-agent can write to a branch without affecting shared state. **Promotion** validates branch data against promotion policies (minimum confidence, evidence count, optional user confirmation) before merging to shared scope.

### Leases
**Leases** provide advisory coordination for multi-agent resource access. They expire naturally if an agent crashes.

### Evidence Decay
Runbook and anti-runbook confidence decays over time. Anti-runbooks decay by 0.8x every 90 days of inactivity. Runbooks with high failure rates get demoted. Stale items are marked for review.

### Timeline & Snapshots (Horizon 4)
The **timeline** is a chronological event log materialized from the append-only evidence log. **Snapshots** reconstruct the knowledge state at any point in time.

### Deep Extraction (Horizon 5)
Optional LLM-powered extraction of entity relationships and richer claims from unstructured text. Gated by config, uses the same model infrastructure as conversation summarization.

## Evidence Log
Every mutation to the evidence store is recorded in an append-only evidence log. This provides a complete audit trail, enables timeline reconstruction, and powers snapshot queries. Events are ordered by scope-local sequence numbers for causal consistency.

## Scopes & Branches
All evidence is scoped — associated with a scope (global, project, workspace) and optionally a branch (shared, run, subagent, hypothesis). The global scope (id=1) is seeded on first migration.

## Source Trust Hierarchy
Claims have a trust score based on their source:
- Tool results: 1.0 (highest)
- User explicit ("Remember: X"): 0.9
- Recent documents: 0.7
- Old documents: 0.4
- Summaries: 0.3
- Inferred: 0.2 (lowest)

## Extraction & Provenance

### Extraction Modes
ClawCore extracts structured knowledge from every message using one of two modes:

**Smart mode** (default when deep extraction model is configured): A single structured LLM call classifies the message and extracts all memory events in one pass. The LLM understands natural language without magic prefixes — "We're going with Postgres" is recognized as a decision, "Actually no, use MySQL" as a correction, "I think it's port 8080" as an uncertain claim. Uses the same model configured for deep extraction. Falls back to fast mode if the LLM call fails.

**Fast mode** (default when no model is configured): Regex-only extraction with no LLM calls, completing in <5ms. Detects structured signals: "Remember:" statements, heading+bullet patterns, YAML frontmatter, tool results, "We decided..." patterns, capitalized entity names, and correction/uncertainty/preference/temporal signals.

Configure with: `CLAWCORE_MEMORY_RELATIONS_EXTRACTION_MODE=smart|fast`

### Unified Ontology
All extracted knowledge is represented as `MemoryObject` instances. There are 13 kinds: event, chunk, message, summary, claim, decision, entity, loop, attempt, procedure, invariant, delta, and conflict. Each MemoryObject carries provenance (where it came from), confidence, freshness, a lifecycle status, and an influence weight.

### Provenance Links
Cross-object relationships are stored in a single `provenance_links` table with typed predicates: derived_from, supports, contradicts, supersedes, mentioned_in, relates_to, resolved_by. This replaces 7 legacy join tables (entity_mentions, claim_evidence, entity_relations, runbook_evidence, anti_runbook_evidence, and implicit summary/conflict linkage).

### TruthEngine
When new MemoryObjects are extracted, the TruthEngine reconciles them against existing knowledge using 6 rules:
1. Higher confidence supersedes lower
2. Equal confidence — newer wins
3. Lower confidence adds supporting evidence
4. Contradictory values create first-class Conflict objects
5. Correction signals ("actually...") trigger auto-supersession with a 5-point safety guard
6. Provisional statements ("I think...") don't override established beliefs

## Context Compiler & ROI Governor
The context compiler scores every evidence capsule on usefulness, confidence, freshness, and scope fit. It ranks by score-per-token and fills the budget greedily. Budget tiers: Lite (110 tokens), Standard (190), Premium (280).
