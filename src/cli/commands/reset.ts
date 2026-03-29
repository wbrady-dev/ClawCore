import { Command } from "commander";
import { resolve } from "path";
import { existsSync } from "fs";
import { createInterface } from "readline";
import { config } from "../../config.js";
import { getDb } from "../../storage/sqlite.js";
import { resetKnowledgeBase } from "../../storage/collections.js";
import { getApiBaseUrl } from "../../tui/platform.js";

export const resetCommand = new Command("reset")
  .description("Reset ThreadClaw data (knowledge base, Evidence OS, memory)")
  .option("--kb-only", "Reset knowledge base only (default)")
  .option("--full", "Reset KB + Evidence OS graph")
  .option("--nuke", "Full wipe: KB + Evidence OS + conversation memory")
  .option("-y, --yes", "Skip confirmation prompt")
  .addHelpText("after", `
Examples:
  $ threadclaw reset                    Reset knowledge base (interactive confirm)
  $ threadclaw reset --kb-only --yes    Reset KB, skip confirmation
  $ threadclaw reset --full --yes       Reset KB + Evidence OS graph
  $ threadclaw reset --nuke --yes       Full wipe — everything including memory`)
  .action(
    async (opts: {
      kbOnly?: boolean;
      full?: boolean;
      nuke?: boolean;
      yes?: boolean;
    }) => {
      try {
        // Determine scope — default to kb-only
        const scope = opts.nuke ? "nuke" : opts.full ? "full" : "kb-only";
        const clearGraph = scope === "full" || scope === "nuke";
        const clearMemory = scope === "nuke";

        const scopeLabel =
          scope === "nuke"
            ? "FULL WIPE (KB + Evidence OS + conversation memory)"
            : scope === "full"
              ? "KB + Evidence OS graph"
              : "Knowledge base only";

        // Confirmation
        if (!opts.yes) {
          const warning =
            scope === "nuke"
              ? "WARNING: This will permanently delete ALL data — documents, embeddings, Evidence OS graph, conversation history, summaries, and memory. This cannot be undone."
              : scope === "full"
                ? "This will permanently delete all documents, embeddings, AND Evidence OS graph data. This cannot be undone."
                : "This will permanently delete all documents, chunks, and embeddings. Evidence OS graph data will be preserved. This cannot be undone.";

          console.log(`\nScope: ${scopeLabel}`);
          console.log(`\n${warning}\n`);

          const confirmed = await confirm(
            scope === "nuke"
              ? 'Type "DELETE EVERYTHING" to confirm: '
              : "Are you sure? (y/N): ",
            scope === "nuke" ? "DELETE EVERYTHING" : "y",
          );

          if (!confirmed) {
            console.log("Reset cancelled.");
            return;
          }
        }

        console.log(`\nResetting: ${scopeLabel}...`);

        // Try API first (if services running), fall back to direct DB access
        let data: any = null;
        try {
          const res = await fetch(`${getApiBaseUrl()}/reset`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ clearGraph, clearMemory, confirm: true }),
            signal: AbortSignal.timeout(10000),
          });
          if (res.ok) data = await res.json();
        } catch {}

        if (!data) {
          // Direct DB access — services not running
          const dbPath = resolve(config.dataDir, "threadclaw.db");
          if (!existsSync(dbPath)) {
            console.log("No database found — nothing to reset.");
            return;
          }
          const db = getDb(dbPath);
          const stats = resetKnowledgeBase(db);
          data = { ...stats, graphCleared: false };

          if (clearGraph && config.relations?.graphDbPath) {
            try {
              const { getGraphDb } = await import("../../storage/graph-sqlite.js");
              const { clearAllGraphTables } = await import("../../relations/ingest-hook.js");
              const graphDb = getGraphDb(config.relations.graphDbPath);
              clearAllGraphTables(graphDb);
              data.graphCleared = true;
            } catch {}
          }

          if (clearMemory) {
            try {
              const { DatabaseSync } = await import(/* @vite-ignore */ "node:" + "sqlite");
              const { homedir } = await import("os");
              const candidates = [
                resolve(config.dataDir, "memory.db"),
                resolve(homedir(), ".threadclaw", "data", "memory.db"),
              ];
              const memPath = candidates.find((p) => existsSync(p)) ?? candidates[0];
              if (existsSync(memPath)) {
                const memDb = new DatabaseSync(memPath);
                const ALLOWED_MEM_TABLES = new Set(["conversations", "messages", "summaries", "context_items", "summary_parents", "summary_messages", "message_parts", "large_files", "messages_fts", "summaries_fts"]);
                const safeCount = (tbl: string) => { if (!ALLOWED_MEM_TABLES.has(tbl)) return 0; try { return (memDb.prepare(`SELECT COUNT(*) as c FROM ${tbl}`).get() as any)?.c ?? 0; } catch { return 0; } };
                data.memoryStats = {
                  conversations: safeCount("conversations"),
                  messages: safeCount("messages"),
                  summaries: safeCount("summaries"),
                  contextItems: safeCount("context_items"),
                };
                const memTables = ["context_items", "summary_parents", "summary_messages", "message_parts", "large_files", "summaries", "messages", "conversations"];
                for (const tbl of memTables) { if (!ALLOWED_MEM_TABLES.has(tbl)) continue; try { memDb.exec(`DELETE FROM ${tbl}`); } catch {} }
                try { memDb.exec("DELETE FROM messages_fts"); } catch {}
                try { memDb.exec("DELETE FROM summaries_fts"); } catch {}
                try { memDb.exec("VACUUM"); } catch {}
                memDb.close();
                data.memoryCleared = true;
              }
            } catch {}
          }
        }

        // Print results
        console.log(`\nReset complete.\n`);
        console.log(`  KB: ${data.documentsDeleted ?? 0} documents, ${data.chunksDeleted ?? 0} chunks, ${data.collectionsDeleted ?? 0} collections deleted`);

        if (data.graphCleared) {
          console.log("  Evidence OS: all graph data cleared");
        } else if (clearGraph) {
          console.log("  Evidence OS: not found or already empty");
        } else {
          console.log("  Evidence OS: preserved");
        }

        if (data.memoryCleared && data.memoryStats) {
          const ms = data.memoryStats;
          console.log(`  Memory: ${ms.conversations} conversations, ${ms.messages} messages, ${ms.summaries} summaries, ${ms.contextItems} context items — wiped`);
        } else if (data.memoryCleared) {
          console.log("  Memory: all wiped");
        } else if (clearMemory) {
          console.log("  Memory: not found or already empty");
        } else {
          console.log("  Memory: preserved");
        }

        console.log("");
      } catch (err) {
        console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
        process.exit(1);
      }
    },
  );

function confirm(prompt: string, expected: string): Promise<boolean> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase() === expected.toLowerCase());
    });
  });
}
