# 🦞 ClawCore — Stateful Evidence Engine

**ClawCore** brings a knowledge and memory backbone to [OpenClaw](https://openclaw.ai), built on the **RSMA (Reconciled Semantic Memory Architecture)** — a multi-layer agent architecture that combines retrieval, summary lineage, knowledge graphs, awareness, evidence-backed state, delta tracking, attempt memory, branch governance, and low-token context compilation. It gives your AI agent persistent, inspectable, evidence-backed memory.

### Evidence OS

ClawCore's Evidence OS extracts structured knowledge from conversations, documents, and tool results — then surfaces it at the right time via an ROI-governed context compiler.

- **Entity Awareness** — Extracts entities from text, detects mismatches across sources, surfaces contextual notes
- **Claims & Decisions** — Tracks factual claims with evidence chains, manages decision history with automatic supersession
- **Open Loops** — Tracks pending tasks, questions, and dependencies with priority ordering
- **Invariants & Capabilities** — Stores durable constraints and tracks available tools/services
- **Attempt Ledger** — Records tool outcomes, calculates success rates per tool
- **Runbooks & Anti-Runbooks** — Learns success patterns and failure patterns from tool history
- **Branch Promotion** — Speculative memory with policy-validated promotion to shared scope
- **Timeline & Snapshots** — Event timeline materialization and point-in-time state reconstruction
- **Deep Extraction** — Optional LLM-powered relationship extraction and evidence synthesis
- **Context Compiler** — ROI-scored capsule compilation with configurable token budgets (110-280 tokens)
- **12 Agent Tools** — `cc_grep`, `cc_describe`, `cc_expand`, `cc_recall`, `cc_claims`, `cc_decisions`, `cc_loops`, `cc_attempts`, `cc_branch`, `cc_procedures`, `cc_diagnostics`, `cc_memory`

### RSMA Architecture

> `RSMA = RAG + DAG + KG + AL + SL + DE + AOM + BSG + EEL + CCL`

**R**etrieval-Augmented Generation, **D**irected **A**cyclic **G**raph summary lineage, **K**nowledge **G**raphs, **A**wareness **L**ayer, **S**tate **L**ayer, **D**elta tracking / **D**eep **E**xtraction, **A**ttempt/**O**utcome **M**emory, **B**ranch/**S**cope **G**overnance, **E**vidence **E**vent **L**og, **C**ontext **C**ompilation **L**ayer.

## Features

- **Hybrid Search** — dense vector + BM25 keyword matching fused via Reciprocal Rank Fusion
- **Cross-Encoder Reranking** — re-scores results with a cross-encoder for precision
- **Smart Rerank Skip** — bypasses reranking when the top result is already a clear winner
- **Token-Efficient Output** — `--brief` (~200 tokens), `--titles` (~30 tokens), `--full` (~1500 tokens)
- **Search Highlighting** — matched query terms in bold for brief mode
- **Query Cache** — 50-entry LRU, 5-minute TTL. Repeat queries cost zero tokens
- **Query Expansion** — optional HyDE + decomposition + multi-query via local LLM
- **Query Analytics** — track search quality, latency, confidence, and identify improvement areas
- **Semantic Deduplication** — near-duplicate chunks detected via cosine similarity during ingest
- **Incremental Re-indexing** — re-chunk and re-embed documents when settings change
- **20+ File Formats** — PDF, DOCX, PPTX, HTML, Markdown, CSV, JSON, Email, Code, and more
- **Incremental Indexing** — detects unchanged files by content hash, never re-processes
- **Auto-Ingestion** — file watcher monitors directories and ingests changes automatically
- **Named Entity Recognition** — spaCy NER extracts people, organizations, locations, dates from ingested content
- **Source Adapters** — Google Drive, Notion, Apple Notes, Obsidian, local files
- **Collections** — organize documents into named collections
- **Interactive TUI** — terminal UI for configuration, status, service management, and uninstall
- **CLI** — full command-line interface for scripting and automation
- **HTTP API** — REST endpoints with rate limiting and path validation
- **MCP Server** — Model Context Protocol for native tool access from AI agents
- **Memory Engine** — DAG-based lossless conversation context (forked from lossless-claw)
- **OpenClaw Integration** — one-command setup as knowledge skill + memory engine
- **Cross-Platform** — Windows, macOS, Linux
- **Local-First** — all models run on your hardware. No data leaves your machine.

## Documentation

**Getting Started:**
[Install](docs/install.md) | [Quick Start](docs/quickstart.md) | [Configuration](docs/configuration.md) | [Migration](docs/migration.md)

**Reference:**
[Tools (12)](docs/tools.md) | [Schema (21 tables)](docs/schema.md) | [API](docs/api.md) | [FAQ](docs/faq.md)

**Concepts:**
[Core Concepts](docs/concepts.md) | [Architecture](docs/architecture.md) | [Scopes & Branches](docs/scopes-and-branches.md) | [Promotion Policies](docs/promotion-policies.md)

**Advanced:**
[Runbooks & Anti-Runbooks](docs/runbooks-and-negative-memory.md) | [Invariants](docs/invariants.md) | [Capabilities](docs/capability-registry.md) | [Evaluation](docs/evaluation.md)

**Operations:**
[Security & Privacy](docs/security-and-privacy.md) | [Performance](docs/performance.md) | [Observability](docs/observability.md) | [Replay & Rebuild](docs/replay-and-rebuild.md) | [Troubleshooting](docs/troubleshooting.md)

**Contributing:**
[Contributor Guide](docs/contributor-guide.md) | [Testing](docs/testing.md) | [Release Process](docs/release-process.md)

## Quick Start

### Windows

```bash
git clone https://github.com/wbrady-dev/ClawCore.git
cd clawcore
install.bat
```

### Linux / Mac

```bash
git clone https://github.com/wbrady-dev/ClawCore.git
cd clawcore
chmod +x install.sh
./install.sh
```

Or launch the interactive TUI installer:

```bash
npm install && npx tsx src/tui/index.ts
```

The installer will:
1. Check prerequisites (Node.js 22+, Python 3+, GPU, disk space)
2. Let you choose a model tier (Lite ~2GB, Standard ~4GB, Premium ~12GB VRAM)
3. Install dependencies, download models, OCR, audio transcription, and NER
4. Detect and connect Obsidian vaults
5. Optionally integrate with OpenClaw

After install, run `clawcore` to launch the TUI.

## Model Tiers

| Tier | Embedding | Reranking | VRAM | Quality |
|------|-----------|-----------|------|---------|
| **Lite** | all-MiniLM-L12-v2 | MiniLM Rerank (Small) | ~2 GB | Good |
| **Standard** | bge-large-en-v1.5 | bge-reranker-large | ~3 GB | Great |
| **Premium** | Nemotron Embed 3B | bge-reranker-v2-gemma | ~11 GB | Best |
| **Custom** | Any HuggingFace model | Any cross-encoder | Varies | Varies |

All models run locally. Cloud providers (OpenAI, Cohere, Voyage AI, Google) also supported.

## Usage

### CLI

```bash
# Search
clawcore query "what is VLSM?" --collection networking --brief

# Ingest a file
clawcore ingest ./research-paper.pdf --collection research

# Ingest a folder recursively
clawcore ingest ./documents/ -r --collection docs

# Simple search (no reranking, faster)
clawcore search "subnet mask" --collection networking

# List collections
clawcore collections list

# System status
clawcore status

# Launch interactive TUI
clawcore
```

### Output Modes

| Mode | Flag | Tokens | Use Case |
|------|------|--------|----------|
| Brief | `--brief` | ~200 | Default. Best for agents. Includes highlighting. |
| Titles | `--titles` | ~30 | Exploration. "What docs do I have?" |
| Full | `--full` | ~1500 | Read the actual content. |

## Source Adapters

| Source | Type | Setup |
|--------|------|-------|
| **Local Files** | Realtime (chokidar) | WATCH_PATHS in .env |
| **Obsidian** | Realtime | Auto-detected during install |
| **Google Drive** | Polling | OAuth flow in TUI Sources screen |
| **OneDrive** | Polling | OAuth or local sync folder |
| **Notion** | Polling | API key in TUI Sources screen |
| **Apple Notes** | Polling | macOS only, AppleScript |

Configure from `Sources` in the TUI. All indexing runs locally.

## OpenClaw Integration

ClawCore integrates with OpenClaw as both a **knowledge skill** and **memory engine**:

1. **Knowledge Engine** — agents search your documents via `clawcore query`
2. **Memory Engine** — DAG-based conversation context (replaces built-in memory-core)

The installer handles this automatically, or run manually:

```bash
python server/integrate_openclaw.py ~/.openclaw ./clawcore nvidia/llama-nv-embed-reasoning-3b
```

## HTTP API

```
GET  /health              — Service health check
GET  /stats               — System statistics (includes token usage)
POST /query               — Search knowledge base
POST /search              — Simple search (no reranking)
POST /ingest              — Ingest file by path
POST /ingest/text         — Ingest raw text
GET  /collections         — List collections
POST /collections         — Create collection
DELETE /collections/:id   — Delete collection (invalidates cache)
GET  /collections/:id/stats — Collection statistics
POST /reindex             — Re-ingest all documents (localhost only)
POST /reindex/stale       — Re-ingest only modified documents (localhost only)
GET  /analytics           — Query performance summary
GET  /analytics/recent    — Recent queries with full details
DELETE /analytics         — Clear analytics data
GET  /sources             — Source adapter status
POST /sources/reload      — Hot-reload source configuration (localhost only)
```

Default port: 18800 (localhost only; set `CLAWCORE_HOST=0.0.0.0` to expose)

Rate limited: 300 requests/minute per IP (configurable via `RATE_LIMIT_MAX`).

## Architecture

```
                    ClawCore (Node.js :18800)
                    ┌───────────────────────────────┐
  clawcore query →  │  Query Pipeline               │
  HTTP POST      →  │  cache → expand →             │
  MCP tool       →  │  retrieve → gate →            │
                    │  rerank → highlight →         │
                    │  brief/titles/full            │
                    └───────────────┬───────────────┘
                                    │
                    ┌───────────────┴───────────────┐
                    │  SQLite + sqlite-vec          │
                    │  vectors │ FTS5 │ WAL         │
                    └───────────────┬───────────────┘
                                    │
                    ┌───────────────┴───────────────┐
                    │  Model Server (Python) :8012  │
                    │  embed │ rerank │ OCR │ NER   │
                    │  threaded │ float16 │ warmup  │
                    └───────────────────────────────┘
```

## Requirements

- **Node.js** 22+
- **Python** 3.10+
- **GPU** recommended (NVIDIA CUDA 12+), CPU mode available
- **Disk** ~15-20GB for models and data

## Credits

- **Memory Engine** based on [lossless-claw](https://github.com/nicobailon/lossless-claw) by [Martian Engineering](https://github.com/nicobailon) / [Voltropy](https://x.com/Voltropy) (MIT License). DAG-based lossless conversation memory with incremental compaction.
- **ClawCore** created by Wesley Brady for [OpenClaw](https://openclaw.ai).

## License

MIT
