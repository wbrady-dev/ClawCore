# Installation Guide

## Prerequisites

- **Node.js 22+** (with experimental SQLite support)
- **Python 3.10+** (for embedding/reranking model server)
- **GPU recommended** (2-12 GB VRAM depending on model tier)
- **Disk space**: ~2-15 GB for models + data

## Quick Install

### Windows

```bash
git clone https://github.com/openclaw/clawcore.git
cd clawcore
install.bat
```

### Linux / macOS

```bash
git clone https://github.com/openclaw/clawcore.git
cd clawcore
chmod +x install.sh
./install.sh
```

### Interactive TUI Installer

```bash
npm install && npx tsx src/tui/index.ts
```

The installer will:
1. Check prerequisites (Node.js, Python, GPU, disk space)
2. Let you choose a model tier (Lite ~2GB, Standard ~4GB, Premium ~12GB)
3. Install dependencies and download models (recommended mode includes OCR via Tesseract, audio transcription via Whisper base, and NER via spaCy)
4. Detect and connect Obsidian vaults
5. Optionally integrate with OpenClaw

## Storage Paths

| Path | Purpose |
|------|---------|
| `~/.clawcore/data/memory.db` | Conversation memory (memory engine) |
| `~/.clawcore/data/graph.db` | Evidence graph (entity awareness, claims, etc.) |
| `~/.clawcore/data/clawcore.db` | Document store (RAG) |
| `~/.clawcore/relations-terms.json` | User-defined entity terms |
| `~/.clawcore/manifest.json` | Version tracking |

## Database Initialization

All databases are created automatically on first run. Schema migrations run idempotently on every startup — safe to upgrade in place.

- Memory engine: 1 migration (conversation tables)
- Evidence graph: 6 migrations (v1: infrastructure + entities, v2: claims/decisions, v3: attempts/runbooks, v4: leases, v5: runbook evidence, v6: entity relations)

## Configuration

Copy `.env.example` to `.env` and customize. See [Configuration Guide](configuration.md) for all options.

## Permissions

- **Unix/macOS**: Evidence graph DB set to `chmod 600` (owner-only access)
- **Windows**: Relies on user-profile directory ACLs (default Windows security)

## Verification

```bash
clawcore status    # Check system health
clawcore doctor    # Full diagnostic: versions, data, integration, services, skills
clawcore query "test" --collection default   # Verify search works
```

## Post-Install Commands

| Command | When to Use |
|---------|-------------|
| `clawcore doctor` | Diagnose installation health — checks versions, data paths, OpenClaw integration, DB integrity |
| `clawcore upgrade` | Run after updating ClawCore code — safely migrates data, schemas, and skills |
| `clawcore integrate --check` | Verify OpenClaw integration is correct (read-only) |
| `clawcore integrate --apply` | Re-apply integration if `clawcore doctor` reports drift |

## Data Locations

All ClawCore data is stored under `~/.clawcore/`:

| Path | Contents |
|------|----------|
| `~/.clawcore/data/clawcore.db` | Document store (RAG) |
| `~/.clawcore/data/memory.db` | Conversation memory |
| `~/.clawcore/data/graph.db` | Evidence graph |
| `~/.clawcore/manifest.json` | Version tracking |
| `~/.clawcore/backups/` | Upgrade backups |

## Troubleshooting

See [Troubleshooting Guide](troubleshooting.md).
