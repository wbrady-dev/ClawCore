---
name: clawcore-evidence
description: ClawCore Evidence OS — structured memory for agents. Most features are automatic. Use cc_memory to search for anything, cc_state for overview, cc_diagnostics for health.
---

# ClawCore Evidence OS

ClawCore automatically extracts and tracks structured knowledge from conversations. Claims, decisions, relationships, and awareness notes are created and injected without tool calls.

**Most of CRAM is automatic. You do not need to call tools for it to work.**

## What happens automatically (no tool call needed)
- **Awareness notes** injected into your system prompt every turn — surfaces mismatches, stale references, and entity connections
- **Named entity extraction** via spaCy NER — people, organizations, locations, dates extracted from all ingested content and conversations
- **Claims** extracted from "Remember:" statements, narrative facts, document headings, YAML frontmatter
- **Decisions** extracted from "We decided..." and similar patterns
- **Tool outcomes** tracked from every tool execution (success/fail, duration, error)
- **Runbooks** learned automatically from successful tool patterns
- **Anti-runbooks** learned from repeated failure patterns
- **Context capsules** compiled and injected each turn (top claims, decisions, warnings, constraints) within a token budget
- **Confidence decay** reduces stale evidence over time
- **Evidence archival** when data exceeds 5000 events

## CRITICAL RULES

1. **Do not search for information already in your current context.** The capsule already contains the most important facts.
2. **Use `cc_memory` for any recall question.** It searches everything automatically.
3. **Use one tool call, then at most one follow-up.** Never chain 3+ calls.
4. **Do not loop.** If nothing is found, say so.
5. **Never dump raw tool output.** Summarize in 1-3 sentences.
6. **Do not use cc_ask unless the user explicitly asks for synthesis.** It costs LLM tokens.

## Primary Tools (use these)

### cc_memory — Search everything
```json
cc_memory { "query": "what you're looking for" }
cc_memory { "query": "Project Aurora", "scope": "all" }
```
- **This is the main tool.** Use it for any question about facts, decisions, relationships, or past conversations.
- Automatically searches: claims, decisions, relationships, summaries, and messages
- Returns results with source labels (Known Facts, Decisions, Relationships, From Summaries, From Conversation)
- Use `"scope": "all"` to search across all conversations (default: current only)
- If results are truncated, it will tell you. Follow up with `cc_claims` or `cc_state` for complete data.

### cc_state — Current state overview
```json
cc_state {}
```
- Shows all active claims, decisions, and open loops in one call
- Use when the user asks "what do we know" or "what's the current state"

### cc_diagnostics — System health
```json
cc_diagnostics {}
cc_diagnostics { "verbose": true }
```
- Shows internal CRAM health: memory stats, evidence counts, awareness metrics, compiler state
- Use when debugging or when asked about system health
- Not for answering user questions

## Specialist Tools (use when cc_memory isn't enough)

These tools are available for specific queries when `cc_memory` doesn't return enough detail:

| Tool | When to Use |
|------|-------------|
| `cc_claims { "subject": "..." }` | Deep dive into specific claims with evidence chains |
| `cc_decisions { "topic": "..." }` | Decision history with supersession tracking |
| `cc_relate { "entity": "..." }` | Entity relationships and connections |
| `cc_grep { "query": "..." }` | Exact text search in conversation history |
| `cc_describe { "summaryId": "..." }` | Inspect a specific summary (cheap, no sub-agent) |
| `cc_recall { "query": "...", "prompt": "..." }` | Deep semantic recall with DAG expansion (slow, ~2 min) |
| `cc_expand { "summaryId": "..." }` | Expand a compacted summary to recover detail |
| `cc_loops` | Open tasks, questions, and blockers |
| `cc_timeline { "limit": 10 }` | Recent evidence events (audit trail) |
| `cc_conflicts` | Entity mismatches across sources |
| `cc_attempts` | Tool outcome history with success rates |
| `cc_delta` | Recent state changes (what changed since last check) |
| `cc_ask { "question": "...", "extract_claims": true }` | LLM synthesis (costs tokens — only when explicitly asked) |

## Advanced Tools (specialized workflows)

These tools are for specific advanced use cases:

| Tool | When to Use |
|------|-------------|
| `cc_capabilities` | List known tools, services, and their current status |
| `cc_invariants` | List durable constraints and rules (never-break conditions) |
| `cc_runbooks` | Show learned success patterns from tool history |
| `cc_antirunbooks` | Show learned failure patterns to avoid |
| `cc_branch { "name": "..." }` | Create a speculative memory branch (sandbox for experiments) |
| `cc_promote { "branch": "..." }` | Promote a branch to shared scope after validation |

## Decision Tree

```text
User asks something?
  |
  +-- Already in your context? --> USE IT. No tool call.
  |
  +-- Need to recall or find something? --> cc_memory
  |
  +-- Need full state overview? --> cc_state
  |
  +-- cc_memory wasn't enough?
  |     +-- Need exact text? --> cc_grep
  |     +-- Need all claims on a topic? --> cc_claims
  |     +-- Need decision history? --> cc_decisions
  |     +-- Need relationships? --> cc_relate
  |     +-- Need to inspect a summary? --> cc_describe
  |     +-- Need to recover compacted detail? --> cc_expand
  |     +-- Need recent changes? --> cc_delta
  |
  +-- Need system constraints? --> cc_invariants / cc_capabilities
  |
  +-- Need tool history/patterns? --> cc_attempts / cc_runbooks
  |
  +-- Debugging/health check? --> cc_diagnostics
```

## Token Cost Guide

| Tool | Cost | Notes |
|------|------|-------|
| cc_memory | ~100-300 tokens | Searches everything automatically |
| cc_state | ~100 tokens | Full state overview |
| cc_diagnostics | ~200 tokens | Health check |
| cc_claims | ~100 tokens | Specific claims |
| cc_decisions | ~50 tokens | Decision history |
| cc_grep | ~50-200 tokens | Exact text search |
| cc_describe | ~50 tokens | Cheap summary inspection |
| cc_delta | ~50 tokens | Recent changes |
| cc_loops | ~50 tokens | Open tasks |
| cc_relate | ~100 tokens | Entity relationships |
| cc_conflicts | ~100 tokens | Mismatch detection |
| cc_attempts | ~100 tokens | Tool outcome history |
| cc_expand | ~200 tokens | Summary expansion |
| cc_recall | ~200-500 tokens | Deep recall — slow (~2 min), use sparingly |
| cc_ask | ~500-1500 tokens | LLM synthesis — expensive, only when asked |

## How Awareness Works

Awareness notes are automatically injected into your system prompt. They surface:
- **Mismatches** — when the same entity appears with conflicting context across sources
- **Stale references** — entities you mention that haven't been seen recently
- **Connections** — entities that co-occur in the same documents

Entities are extracted using spaCy NER (people, organizations, locations, dates, events, products) and regex patterns. The entity cache refreshes immediately when new entities are added.

You do not need to call any tool for awareness — it runs every turn automatically.

## Tool Availability

All tools require Evidence OS to be enabled (`CLAWCORE_MEMORY_RELATIONS_ENABLED=true`, which is the default).

The 4 core tools (`cc_memory`, `cc_grep`, `cc_describe`, `cc_expand`) are always available regardless of Evidence OS settings.

If evidence tools are not available in your toolset, they may not have registered for this session. Starting a new session after ClawCore services are running should resolve this.

## Setup

This skill is installed automatically during ClawCore installation.

Evidence OS is configured in the ClawCore TUI under **Configure > Evidence OS**, or in `.env`.
