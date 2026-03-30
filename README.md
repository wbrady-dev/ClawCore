# 🦞 ThreadClaw 

**The memory layer your AI agent is missing.**

![tests](https://img.shields.io/badge/tests-979%20passing-brightgreen)
![build](https://img.shields.io/github/actions/workflow/status/LostBySea/ThreadClaw/ci.yml?branch=main&label=build)
![license](https://img.shields.io/badge/license-MIT-blue)
![node](https://img.shields.io/badge/node-22%2B-green)
![platform](https://img.shields.io/badge/platform-windows%20%7C%20linux%20%7C%20macos-lightgrey)

ThreadClaw gives AI agents something they normally lose after every conversation: **memory that lasts, learns, and corrects itself.** It combines a full RAG pipeline, a lossless conversation engine, and a knowledge graph into a single local-first system that runs entirely on your machine.

Your documents from Obsidian, OneDrive, Google Drive, Notion, Apple Notes, and local files are continuously indexed and searchable. Every conversation is preserved in a lossless DAG. Claims, decisions, and observations are extracted in real time, reconciled against what the agent already knows, and compiled into context that actually helps.

No cloud dependency. No token-per-query pricing. Your data stays yours.

---

## Why ThreadClaw Exists

Most AI memory solutions do one thing: stuff recent chat history into the context window and hope for the best. When the window fills up, the oldest messages are silently dropped. The agent forgets what you told it yesterday.

ThreadClaw takes a fundamentally different approach:

- **Nothing is thrown away.** Every message is stored in a lossless DAG (directed acyclic graph). Compaction creates summaries, but the originals are always preserved and expandable.
- **Memory isn't just text — it's structured knowledge.** Claims, decisions, entities, and relationships are extracted from every conversation and reconciled into a knowledge graph.
- **The agent knows what it knows** — and what it's unsure about. Epistemic labels (`[FIRM]`, `[CONTESTED]`, `[PROVISIONAL]`) tell the model which facts to trust and which to verify.
- **Your documents become the agent's knowledge base.** Real-time RAG with hybrid BM25 + vector search, reranking, and intelligent chunking across all your file sources.

---

## Architecture

ThreadClaw runs as two local processes that work together:

```
┌─────────────────────────────────────────────────────────────────┐
│                        ThreadClaw                               │
│                                                                 │
│  ┌──────────────────────┐     ┌──────────────────────────────┐  │
│  │    Node.js Server    │     │      Python Model Server     │  │
│  │    (port 18800)      │     │      (port 8012)             │  │
│  │                      │     │                              │  │
│  │  RAG Query Pipeline  │───▶   Embedding (mxbai-embed)      
│  │  Document Ingestion  │     │  Reranking (bge-reranker)    │  │
│  │  File Watcher        │     │  Document Parsing (Docling)  │  │
│  │  Knowledge Graph     │     │  NER (spaCy)                 │  │
│  │  Evidence OS         │     │                              │  │
│  │  HTTP API            │     └──────────────────────────────┘  │
│  │  TUI / CLI           │                                       │
│  └──────────┬───────────┘                                       │
│             │                                                   │
│  ┌──────────▼───────────┐     ┌──────────────────────────────┐  │
│  │  Memory Engine       │     │     Source Adapters          │  │
│  │  (OpenClaw Plugin)   │     │                              │  │
│  │                      │     │  Obsidian  ·  OneDrive       │  │
│  │  Lossless DAG        │     │  Google Drive  ·  Notion     │  │
│  │  RSMA Extraction     │     │  Apple Notes  ·  Web URLs    │  │
│  │  Context Compilation │     │  Local Files                 │  │
│  │  Compaction Engine   │     │                              │  │
│  └──────────────────────┘     └──────────────────────────────┘  │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │                    SQLite (WAL mode)                     │   │
│  │  threadclaw.db — RAG chunks, vectors, knowledge graph    │   │
│  │  memory.db — conversations, summaries, context DAG       │   │
│  │  archive.db — cold storage for aged evidence             │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

### The Three Layers

**Layer 1 — RAG Pipeline.** Your documents are chunked semantically, embedded with a local model, and stored in a SQLite vector database. Queries hit a hybrid pipeline: BM25 full-text search and vector similarity are fused with Reciprocal Rank Fusion (RRF), then optionally reranked by a cross-encoder. Results are packed into context with source attribution.

**Layer 2 — Lossless Conversation Memory.** We have integrated [Lossless-Claw](https://github.com/Martian-Engineering/lossless-claw) into ThreadClaw. Every conversation is stored as a DAG of messages, summaries, and context items. When context fills up, the compaction engine produces summaries — but unlike traditional systems, the original messages are never deleted. The agent can always expand a summary back to the full original text via the `cc_recall` tool.

**Layer 3 — Evidence OS (RSMA).** Claims, decisions, entities, relationships, loops, invariants, capabilities, and procedures are extracted from every conversation in real time. A truth engine reconciles new information against existing knowledge: it detects contradictions, creates conflicts, supersedes outdated beliefs, and tracks confidence with evidence accumulation. The context compiler selects the most valuable evidence for each turn using a token-budgeted greedy knapsack algorithm.

---

## Document Sources

ThreadClaw watches your files and keeps the knowledge base current in real time.

| Source | How It Works |
|--------|-------------|
| **Obsidian** | Watches your vault directory. Parses frontmatter, wikilinks, and aliases. Realtime indexing on every save. |
| **OneDrive** | OAuth PKCE authentication (no admin consent needed). Delta sync for incremental updates. Configurable folder selection. |
| **Google Drive** | OAuth2 with CSRF-protected callback. Exports Google Docs/Sheets/Slides to searchable text. Folder-scoped sync. |
| **Notion** | API integration with page and database export. Expands child blocks. Markdown conversion. |
| **Apple Notes** | macOS native integration via AppleScript. Exports note content including rich text. |
| **Web URLs** | Monitors web pages on a configurable interval. Readability extraction strips boilerplate. SSRF protection built in. |
| **Local Files** | Watches any directory via chokidar. Supports PDF, DOCX, PPTX, XLSX, Markdown, HTML, CSV, JSON, email (.eml), ePub, and plain text. |

All sources support:
- **Incremental indexing** — only changed files are re-processed (content hash via xxhash)
- **Collection tagging** — organize documents into searchable collections
- **Manifest persistence** — survives restarts without re-downloading everything
- **Circuit breaker** — pauses ingestion when the embedding server is down, resumes automatically

---

## The RAG Pipeline

```
Query → Cache Check → Query Expansion → Embed → Hybrid Search → Dedup → Threshold Gate → Rerank → Pack → Output
                                           │                                    │
                                     ┌─────┴─────┐                       Cross-encoder
                                     │           │                       (bge-reranker)
                                Vector Search  BM25 FTS5
                                     │           │
                                     └─────┬─────┘
                                       RRF Fusion
```

- **Hybrid search**: Vector similarity (cosine distance via sqlite-vec) fused with BM25 full-text search (SQLite FTS5) using Reciprocal Rank Fusion
- **Smart reranking**: Cross-encoder reranker with automatic skip when the top result already has high confidence (saves latency)
- **Query expansion**: Optional HyDE (Hypothetical Document Embeddings) and multi-query decomposition for complex questions
- **Parent context enrichment**: Retrieved chunks are expanded with surrounding context from the same document
- **Entity boosting**: Entities from the knowledge graph are used to boost relevance for queries about known subjects
- **Query cache**: LRU cache with configurable TTL eliminates redundant embedding + search for repeated queries
- **Output modes**: `--brief` (compressed), `--titles` (document list), `--full` (complete context), or `--synthesize` (LLM-generated answer with citations)

---

## Evidence OS — The Knowledge Graph

Evidence OS is what makes ThreadClaw more than a RAG system. It continuously builds a structured knowledge graph from your conversations.

### What Gets Extracted

| Kind | What It Is | Example |
|------|-----------|---------|
| **Claim** | A factual assertion with subject/predicate/object | "PostgreSQL is the primary database" |
| **Decision** | A recorded choice with topic and rationale | "Use TypeScript for the API layer" |
| **Entity** | A named thing (person, tool, concept) | "Wesley", "ThreadClaw", "PostgreSQL" |
| **Relation** | A semantic link between entities | "ThreadClaw → uses → SQLite" |
| **Loop** | An open task, question, or dependency | "Need to benchmark query latency" |
| **Invariant** | A rule that must not be violated | "Never store API keys in config files" |
| **Procedure** | A learned runbook (or anti-runbook) | "When tests fail: check migration v30 first" |
| **Capability** | A tracked tool or service | "SQLite FTS5 — available" |
| **Attempt** | A tool invocation record | "Called cc_grep, succeeded in 120ms" |
| **Conflict** | A detected contradiction | "Claim A says MySQL, Claim B says PostgreSQL" |
| **Delta** | A state change record | "Database changed from MySQL to PostgreSQL" |

### How Reconciliation Works

When new information arrives, the **Truth Engine** reconciles it against existing knowledge:

1. **Canonical key matching** — New claims are matched against existing ones by normalized subject + predicate
2. **Five-point supersession guard** — A new claim can only replace an existing one if: same canonical key, same scope, same kind family, minimum confidence 0.3, and auditable reason trace
3. **Contradiction detection** — If two claims have different values for the same subject, a Conflict object is created
4. **Confidence propagation** — Supporting evidence increases confidence; contradicting evidence decreases it (with diminishing returns)
5. **Flip-flop dampening** — If a canonical key is superseded 3+ times in 24 hours, the system escalates to conflict instead of continuing to flip
6. **Correction trust bonus** — Explicit corrections from the user get a +0.15 confidence boost

### Smart Context Injection

Every turn, the context compiler selects the most valuable evidence for the model:

- **ROI scoring**: Each piece of evidence gets a score: `(confidence × freshness × relevance) / token_cost`
- **Greedy knapsack**: Items are packed into the token budget by score-per-token, highest first
- **Epistemic labels**: Every claim is tagged `[FIRM]` (high confidence), `[CONTESTED]` (active conflict), or `[PROVISIONAL]` (low confidence)
- **Awareness system**: Proactively surfaces entities and relationships relevant to the current conversation, even if the user didn't ask
- **Session briefing**: On session resume, summarizes what changed since the last interaction

---

## Conversation Memory

ThreadClaw's memory engine replaces the typical "sliding window" approach with a lossless DAG:

```
Messages → Leaf Summaries → Condensed Summaries → ... → Root Summary
    ↑           ↑                   ↑
    └───────────┴───────────────────┘
         Always expandable back to originals
```

- **Safeguard compaction**: When context exceeds 75% of budget, messages are summarized — but originals are preserved in the DAG and can be expanded via `cc_recall`
- **Quality checks**: Summaries must be shorter than their input, contain required sections (decisions, TODOs, identifiers), and pass a coherence check
- **Three-level fallback**: Normal summarization → aggressive → deterministic truncation (guaranteed to complete even if the LLM is unavailable)
- **FTS5 search**: Full-text search across all messages and summaries, ordered by BM25 relevance
- **Session isolation**: Conversations are scoped per-channel-peer with configurable idle reset

---

## Data Lifecycle

Every piece of evidence has a managed lifecycle. Nothing grows unbounded.

| Kind | Decay | Archive |
|------|-------|---------|
| Claims | Confidence × 0.9 after 30d unobserved; stale at < 0.3 | Stale claims with conf < 0.1 after 30d |
| Entities | Stale if mentionCount ≤ 1 after 90d | Stale entities after 90d |
| Decisions | Stale if confidence < 0.5 after 120d | Superseded decisions after 90d |
| Loops | Stale after 72h (configurable) | Superseded/stale loops after 30d |
| Relations | Stale after 180d without update | Superseded relations after 90d |
| Attempts | Hard-deleted after 30d; per-tool cap of 100 | Active attempts older than 30d |
| Procedures | Runbooks decay on failure rate; anti-runbooks on tool success | Stale procedures after 30d |
| Conflicts | Resolved conflicts stale after 30d | Stale conflicts after 30d |
| Capabilities | Unavailable capabilities stale after 90d | Stale capabilities after 90d |
| Invariants | Very conservative — stale after 180d | Not archived (long-lived by design) |
| Deltas | Hard-deleted after 14d | Not archived (ephemeral) |

Archived evidence is moved to `archive.db` with full provenance trails. Restore is supported from day one.

---

## Agent Tools

ThreadClaw provides 16 tools to the AI agent through the OpenClaw plugin interface:

### Core Memory Tools
| Tool | Purpose | Cost |
|------|---------|------|
| `cc_grep` | Search messages and summaries by regex or full-text | ~50-200 tokens |
| `cc_describe` | Inspect a specific summary (cheap, no sub-agent) | ~30-100 tokens |
| `cc_recall` | Deep recall: spawns a bounded sub-agent to expand the DAG | ~500-2000 tokens |
| `cc_expand` | Expand a summary back to its original messages | ~200-1000 tokens |

### Evidence OS Tools
| Tool | Purpose |
|------|---------|
| `cc_memory` | Primary recall tool — queries the knowledge graph |
| `cc_diagnostics` | System health and extraction statistics |
| `cc_state` | Aggregates all knowledge about a subject |
| `cc_timeline` | Subject evolution over time |
| `cc_manage_loop` | Close or update open loops |
| `cc_conflicts` | View unresolved contradictions and resolve them |
| `cc_claims`, `cc_decisions`, `cc_loops`, `cc_attempts`, `cc_procedures` | Kind-specific queries |

### RAG Tools
| Tool | Purpose |
|------|---------|
| `threadclaw query` | Search the document knowledge base |
| `threadclaw collections` | List and manage document collections |
| `threadclaw ingest` | Ingest files, folders, or URLs into the knowledge base |

---

## Natural Language Ingestion

Your AI agent can ingest content on your behalf using natural language. Just tell it what to add:

> "Ingest this PDF into the research collection"
> "Add everything in my Documents/notes folder to the notes collection"
> "Ingest https://docs.example.com into the docs collection"
> "Pull in this web page and add it to my knowledge base"

The agent has access to the `threadclaw ingest` command which handles:

- **Local files** — PDFs, DOCX, Markdown, HTML, CSV, JSON, email, ePub, plain text, and more
- **Folders** — recursively ingest all supported files in a directory
- **URLs** — fetch any web page or text file, extract the content, and ingest it directly
- **Collections** — organize everything into named, searchable collections

No manual configuration needed. The agent fetches, parses, chunks, embeds, and indexes — you just say what you want added.

---

## Quick Start

### Prerequisites
- Node.js 22+ and npm 10+
- Python 3.10+ (for local embedding/reranking models)
- ~4 GB disk for models (GPU recommended but not required)

### Install

```bash
git clone https://github.com/LostBySea/ThreadClaw.git
cd ThreadClaw
# Windows
install.bat
# Linux / macOS
./install.sh
```

The installer handles everything: Node dependencies, Python venv, model downloads, database setup, service registration, and OpenClaw integration.

### Update

```bash
threadclaw update
```

One command. Stops services, backs up data, pulls latest, rebuilds, runs migrations, restarts. Rolls back automatically on failed git pull.

### Usage

```bash
# Launch the interactive TUI
threadclaw

# Search your knowledge base
threadclaw query "how does the auth system work" --collection workspace

# Ingest a document
threadclaw ingest ~/Documents/architecture.md --collection design

# Check system health
threadclaw doctor

# View Evidence OS state
threadclaw relations
```

---

## OpenClaw Integration

ThreadClaw is designed as a plugin for [OpenClaw](https://docs.openclaw.ai), the personal AI assistant framework. When integrated:

- ThreadClaw replaces the built-in memory system with its lossless DAG + knowledge graph
- All 16 agent tools become available to the AI in every conversation
- Evidence context is automatically injected into the system prompt each turn
- Compaction is managed by ThreadClaw (the gateway's built-in compaction is disabled)
- Workspace skills (`threadclaw-knowledge` and `threadclaw-evidence`) provide natural-language routing

Integration is automatic during install, or can be triggered manually:

```bash
threadclaw integrate
```

---

## HTTP API

ThreadClaw exposes a comprehensive REST API on `localhost:18800`:

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/query` | POST | Search with full RAG pipeline |
| `/health` | GET | Service health check |
| `/stats` | GET | System statistics |
| `/collections` | GET/POST/DELETE | Collection management |
| `/documents` | GET/DELETE | Document management |
| `/ingest` | POST | Ingest file or text |
| `/reindex` | POST | Reindex collection (with timeout protection) |
| `/graph/entities` | GET | Entity browser |
| `/graph/claims` | GET | Claims browser |
| `/graph/decisions` | GET | Decisions browser |
| `/graph/loops` | GET | Open loops browser |
| `/graph/conflicts` | GET | Conflict browser |
| `/graph/procedures` | GET | Runbook browser |
| `/graph/truth-health` | GET | Confidence dashboard |
| `/graph/timeline` | GET | Subject evolution timeline |
| `/graph/terms` | GET/PUT | Term management |
| `/sources` | GET | Source adapter status |
| `/events` | GET | Server-Sent Events stream |
| `/shutdown` | POST | Graceful shutdown |

All endpoints are localhost-only by default. Optional API key authentication via `THREADCLAW_API_KEY`.

---

## Security

- **Local-first**: All data stays on your machine. No cloud calls except to configured model endpoints.
- **Localhost binding**: API server binds to `127.0.0.1` by default.
- **Timing-safe auth**: API key comparison uses constant-time SHA-256.
- **Rate limiting**: Per-IP rate limiting with configurable thresholds.
- **SSRF protection**: Web adapter validates DNS resolution and blocks private IPs.
- **OAuth CSRF protection**: State parameter validation on OneDrive and Google Drive callbacks.
- **DDL validation**: Migration from legacy databases validates DDL against an allowlist before execution.
- **Capsule sanitization**: Evidence injected into agent context is sanitized against prompt injection.
- **Input validation**: All API routes validate and sanitize input. FTS5 queries are properly escaped.
- **Path traversal protection**: Ingest routes validate paths and block sensitive files/directories.
- **File permissions**: Database and credential files are hardened to owner-only on Unix.

---

## Testing

```bash
# Run all tests
npm test

# Memory engine tests (866 tests)
cd memory-engine && npx vitest run

# Source tests (113 tests)
npx vitest run

# Stress + benchmarks
npm run test:stress
```

**979 tests** across 49 test files. CI runs on Ubuntu, Windows, and macOS via GitHub Actions.

Test coverage includes: reconciliation rules, extraction quality (golden corpus), failure injection, security hardening, stress benchmarks (1000 entities under 5s, 500 claims under 5s), API route tests, migration tests, and integration tests.

---

## Configuration

All configuration lives in `.env` with sensible defaults. Key settings:

```bash
# Models
EMBEDDING_MODEL="mixedbread-ai/mxbai-embed-large-v1"  # 1024-dim, MTEB top-tier
RERANKER_MODEL="BAAI/bge-reranker-v2-gemma"            # Cross-encoder reranker

# Search tuning
HYBRID_VECTOR_WEIGHT=0.6          # Vector vs BM25 balance
HYBRID_BM25_WEIGHT=0.4
QUERY_TOP_K=10                     # Results per query
CHUNK_TARGET_TOKENS=512            # Chunk size for semantic splitting

# Source adapters
WATCH_PATHS="/path/to/obsidian,/path/to/docs"
GDRIVE_ENABLED=true
OBSIDIAN_ENABLED=true
```

See [`.env.example`](.env.example) for the full reference with documentation for every option.

---

## Documentation

| Document | What It Covers |
|----------|---------------|
| [TECHNICAL.md](TECHNICAL.md) | Deep technical reference — pipelines, schemas, algorithms |
| [docs/architecture.md](docs/architecture.md) | System design and component interactions |
| [docs/configuration.md](docs/configuration.md) | Complete configuration reference |
| [docs/install.md](docs/install.md) | Detailed installation guide |
| [docs/rsma-architecture.md](docs/rsma-architecture.md) | RSMA knowledge graph deep dive |
| [docs/security-and-privacy.md](docs/security-and-privacy.md) | Security model and threat analysis |
| [docs/api.md](docs/api.md) | HTTP API reference |
| [docs/tools.md](docs/tools.md) | Agent tool reference |
| [docs/troubleshooting.md](docs/troubleshooting.md) | Common issues and solutions |

---

## Requirements

| Requirement | Minimum | Recommended |
|------------|---------|-------------|
| Node.js | 22 | 22+ (LTS) |
| Python | 3.10 | 3.11+ |
| RAM | 4 GB | 8 GB+ |
| Disk | 2 GB | 4 GB+ (with models) |
| GPU | Not required | CUDA 12.4+ (faster embedding/reranking) |

---

## Credits

ThreadClaw's conversation memory engine is based on [lossless-claw](https://github.com/nicobailon/lossless-claw) by Nico Bailon / Martian Engineering (MIT License). The DAG-based compaction architecture, incremental summarization strategy, and context assembly approach originated from that work and have been extended with RSMA, Evidence OS, source adapters, and the full RAG pipeline.

## License

MIT
