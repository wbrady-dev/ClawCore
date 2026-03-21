"""
OpenClaw Integration Script — ClawCore CRAM
Sets up ClawCore as the unified knowledge + memory system for OpenClaw.

1. Installs SKILL.md for document search routing
2. Configures openclaw.json: Memory Engine plugin, disable memory-core
3. Sets up auto-watch paths (workspace + skills + large files)
4. Updates SOUL.md with unified search routing

Usage: python integrate_openclaw.py <openclaw_dir> <clawcore_dir> <embed_model> [summary_model]

  summary_model: Optional. Model for memory summarization (e.g. "anthropic/claude-sonnet-4-6").
                 If omitted, uses the active session model automatically.
"""

import sys
import os
import json


def main():
    if len(sys.argv) < 4:
        print("[ERROR] Usage: python integrate_openclaw.py <openclaw_dir> <clawcore_dir> <embed_model> [summary_model]")
        sys.exit(1)

    openclaw_dir = sys.argv[1]
    clawcore_dir = sys.argv[2]
    embed_model = sys.argv[3]
    summary_model = sys.argv[4] if len(sys.argv) >= 5 else None

    clawcore_dir_native = os.path.abspath(clawcore_dir)
    memory_engine_dir = os.path.join(clawcore_dir_native, "memory-engine")

    # Ensure clawcore is available as a global command
    try:
        import subprocess
        subprocess.run(["npm", "link"], cwd=clawcore_dir_native, capture_output=True, timeout=30)
    except Exception:
        pass

    # 1. Install SKILL.md — document search routing (NOT conversation memory)
    skill_dir = os.path.join(openclaw_dir, "workspace", "skills", "knowledge")
    os.makedirs(skill_dir, exist_ok=True)

    skill_content = """---
name: knowledge
description: Search document knowledge base (ClawCore). For documents, files, reference material — NOT conversation history (use cc_grep/cc_recall for that).
---

# Knowledge Search (ClawCore)

Use `clawcore query` to search your document knowledge base — files, PDFs, code, reference material, and workspace documents.

## When to use ClawCore
- "What does the documentation say about X?"
- "Find the section about Y in my files"
- "What's in my research papers about Z?"
- Searching workspace files (SOUL.md, AGENTS.md, skill playbooks)
- Any question about ingested documents or reference material

## When NOT to use ClawCore (use ClawCore memory tools instead)
- "What did we discuss earlier?" — use cc_grep or cc_recall
- "What was the decision we made about X?" — use cc_grep or cc_recall
- "Remind me what I said about Y" — use cc_grep or cc_recall
- Any question about conversation history

## Commands

**Default — use --brief (costs ~200 tokens):**
```
exec: clawcore query "search terms" --collection workspace --brief
```

**Exploratory — use --titles first (costs ~30 tokens):**
```
exec: clawcore query "topic" --collection all --titles
```

**Full content — only when user asks to see a document:**
```
exec: clawcore query "search terms" --collection default --full
```

**Ingest a file:**
```
exec: clawcore ingest "path/to/file" --collection default
```

## Collections

| Collection | Content |
|------------|---------|
| workspace | Workspace files |
| skills | Skill playbooks |
| clawcore-files | Large files from conversations |
| default | General knowledge (user-added documents) |

## Efficiency
- Start with `--brief` (default). Only use `--full` if brief was insufficient.
- Prefer one targeted query over multiple broad ones.
- Use `--titles` first if you're not sure what collection to search.

## Token costs
- Brief (default): ~200 tokens
- Titles: ~30 tokens
- No results: ~5 tokens
- Cached repeat: 0 tokens
- Full: ~1500 tokens

## Rules
1. **Use --brief by default** — saves tokens, same answer quality
2. **Cite sources** — mention which document the info came from
3. **Don't dump** — never paste full ClawCore output. Summarize.
4. **Miss is cheap** — "No relevant documents found" costs 5 tokens
"""

    skill_path = os.path.join(skill_dir, "SKILL.md")
    with open(skill_path, "w", encoding="utf-8") as f:
        f.write(skill_content)
    print("[OK] Knowledge skill installed")

    # 2. Configure openclaw.json for CRAM
    config_path = os.path.join(openclaw_dir, "openclaw.json")
    try:
        with open(config_path, "r", encoding="utf-8") as f:
            config = json.load(f)

        # Remove memorySearch if present
        defaults = config.get("agents", {}).get("defaults", {})
        if "memorySearch" in defaults:
            del defaults["memorySearch"]
            print("[OK] Removed built-in memorySearch")

        # Configure plugins
        if "plugins" not in config:
            config["plugins"] = {}
        plugins = config["plugins"]

        # Set slots
        if "slots" not in plugins:
            plugins["slots"] = {}
        plugins["slots"]["memory"] = "none"
        plugins["slots"]["contextEngine"] = "clawcore-memory"

        # Set plugin load path
        if "load" not in plugins:
            plugins["load"] = {}
        if "paths" not in plugins["load"]:
            plugins["load"]["paths"] = []
        if memory_engine_dir not in plugins["load"]["paths"]:
            plugins["load"]["paths"].append(memory_engine_dir)

        # Allow clawcore-memory as trusted plugin
        if "allow" not in plugins:
            plugins["allow"] = []
        if "clawcore-memory" not in plugins["allow"]:
            plugins["allow"].append("clawcore-memory")

        # Configure plugin entries
        if "entries" not in plugins:
            plugins["entries"] = {}
        plugins["entries"]["memory-core"] = {"enabled": False}
        memory_config = {
            "contextThreshold": 0.75,
            "freshTailCount": 32,
            "incrementalMaxDepth": -1,
            "relationsEnabled": True,
            "relationsAwarenessEnabled": True,
            "relationsClaimExtractionEnabled": True,
            "relationsAttemptTrackingEnabled": True,
        }
        if summary_model:
            memory_config["summaryModel"] = summary_model
        plugins["entries"]["clawcore-memory"] = {
            "enabled": True,
            "config": memory_config
        }

        with open(config_path, "w", encoding="utf-8") as f:
            json.dump(config, f, indent=2)
            f.write("\n")
        print("[OK] OpenClaw configured for CRAM (Memory Engine + contextEngine slot)")

    except Exception as e:
        print(f"[WARNING] Could not update openclaw.json: {e}")

    # 3. Install Memory Engine plugin
    try:
        import subprocess
        subprocess.run(
            ["openclaw", "plugins", "install", "--link", memory_engine_dir],
            capture_output=True, timeout=60
        )
        print("[OK] Memory Engine plugin linked")
    except Exception as e:
        print(f"[WARNING] Could not link Memory Engine plugin: {e}")
        print("         Run manually: openclaw plugins install --link " + memory_engine_dir)

    # 4. Configure auto-watch paths (Memory Engine owns conversation — no separate memory collection)
    workspace_dir = os.path.join(openclaw_dir, "workspace")
    skills_dir = os.path.join(workspace_dir, "skills")
    clawcore_files_dir = os.path.join(openclaw_dir, "clawcore-files")
    env_path = os.path.join(clawcore_dir_native, ".env")

    try:
        if os.path.isfile(env_path):
            with open(env_path, "r", encoding="utf-8") as f:
                env_content = f.read()

            # Build watch paths: workspace + skills + clawcore-files (NOT memory)
            watch_entries = []
            if os.path.isdir(workspace_dir):
                watch_entries.append(f"{workspace_dir}|workspace")
            if os.path.isdir(skills_dir):
                watch_entries.append(f"{skills_dir}|skills")
            # clawcore-files may not exist yet — add anyway, watcher handles missing dirs
            watch_entries.append(f"{clawcore_files_dir}|clawcore-files")

            watch_value = ",".join(watch_entries)

            import re
            if "WATCH_PATHS=" in env_content:
                env_content = re.sub(r"WATCH_PATHS=.*", f"WATCH_PATHS={watch_value}", env_content)
            else:
                env_content += f"\nWATCH_PATHS={watch_value}\n"

            # Set token budget to 2000 for CRAM
            if "QUERY_TOKEN_BUDGET=" in env_content:
                env_content = re.sub(r"QUERY_TOKEN_BUDGET=.*", "QUERY_TOKEN_BUDGET=2000", env_content)

            with open(env_path, "w", encoding="utf-8") as f:
                f.write(env_content)

            print("[OK] Auto-watch configured (workspace + skills + clawcore-files)")
        else:
            print("[WARNING] .env not found, skipping auto-watch setup")
    except Exception as e:
        print(f"[WARNING] Could not configure auto-watch: {e}")

    # 5. Add unified routing to SOUL.md
    soul_path = os.path.join(workspace_dir, "SOUL.md")
    routing_section = """

---

## Knowledge Architecture

You have two knowledge systems. Use the right one:

**Conversation Memory (ClawCore memory tools — already in your tool list)**
- For: what we discussed, decisions we made, things I told you, past context
- Tools: cc_grep, cc_recall, cc_describe
- Scope: current conversation by default (use allConversations flag for cross-conversation)

**Document Knowledge (ClawCore — via exec commands in your knowledge skill)**
- For: what files/docs/PDFs say, reference material, workspace files, code
- Commands: see your knowledge skill for clawcore query usage
- Scope: always global across all collections

**Routing rule:** "What did we discuss/decide?" — ClawCore memory tools. "What does the doc say?" — ClawCore knowledge search. Unsure? — ClawCore memory first (cheaper), knowledge search if no results.

**Important:** When you switch conversations, conversation memory resets but document knowledge persists. Documents are always available regardless of conversation."""

    try:
        if os.path.isfile(soul_path):
            with open(soul_path, "r", encoding="utf-8") as f:
                soul = f.read()
            if "Knowledge Architecture" not in soul:
                with open(soul_path, "a", encoding="utf-8") as f:
                    f.write(routing_section)
                print("[OK] Added knowledge routing to SOUL.md")
            else:
                print("[OK] SOUL.md already has knowledge routing")
        else:
            print("[SKIP] No SOUL.md found, skipping routing guidance")
    except Exception as e:
        print(f"[WARNING] Could not update SOUL.md: {e}")

    print()
    print("[OK] ClawCore CRAM integration complete!")
    print("     Architecture: Contextual Retrieval and Augmented Memory")
    print("     - Knowledge Engine: document search via 'clawcore query'")
    print("     - Memory Engine: conversation memory via cc_grep, cc_recall")
    print()
    print("     Restart your OpenClaw gateway to apply changes.")
    print("     Start ClawCore first: clawcore serve (or start-clawcore.sh)")


if __name__ == "__main__":
    main()
