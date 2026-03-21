/**
 * Token usage tracker for CRAM local models.
 * Uses a JSON file as the backing store so all module instances
 * share the same counters (tsx can create isolated module graphs).
 *
 * Writes are buffered in memory and flushed every 5 seconds
 * to avoid excessive file I/O during high-throughput ingestion.
 */
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { resolve } from "path";
import { homedir } from "os";

interface TokenCounts {
  ingest: number;
  embed: number;
  rerank: number;
  queryExpansion: number;
}

const TRACKER_FILE = resolve(homedir(), ".clawcore", "token-counts.json");
const FLUSH_INTERVAL_MS = 5000;

// In-memory buffer for pending increments
const pending: TokenCounts = { ingest: 0, embed: 0, rerank: 0, queryExpansion: 0 };
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function ensureDir(): void {
  try {
    mkdirSync(resolve(homedir(), ".clawcore"), { recursive: true });
  } catch {}
}

function readCounts(): TokenCounts {
  try {
    return JSON.parse(readFileSync(TRACKER_FILE, "utf-8"));
  } catch {
    return { ingest: 0, embed: 0, rerank: 0, queryExpansion: 0 };
  }
}

function writeCounts(counts: TokenCounts): void {
  ensureDir();
  writeFileSync(TRACKER_FILE, JSON.stringify(counts));
}

function flush(): void {
  const hasPending = pending.ingest || pending.embed || pending.rerank || pending.queryExpansion;
  if (!hasPending) return;

  const counts = readCounts();
  counts.ingest += pending.ingest;
  counts.embed += pending.embed;
  counts.rerank += pending.rerank;
  counts.queryExpansion += pending.queryExpansion;
  writeCounts(counts);

  // Reset pending
  pending.ingest = 0;
  pending.embed = 0;
  pending.rerank = 0;
  pending.queryExpansion = 0;
}

function scheduleFlush(): void {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    flush();
  }, FLUSH_INTERVAL_MS);
  // Don't prevent process exit
  if (flushTimer.unref) flushTimer.unref();
}

export function trackTokens(category: keyof TokenCounts, tokens: number): void {
  pending[category] += tokens;
  scheduleFlush();
}

export function getTokenCounts(): TokenCounts {
  // Merge persisted + pending for accurate reads
  const persisted = readCounts();
  return {
    ingest: persisted.ingest + pending.ingest,
    embed: persisted.embed + pending.embed,
    rerank: persisted.rerank + pending.rerank,
    queryExpansion: persisted.queryExpansion + pending.queryExpansion,
  };
}

export function resetTokenCounts(): void {
  pending.ingest = 0;
  pending.embed = 0;
  pending.rerank = 0;
  pending.queryExpansion = 0;
  writeCounts({ ingest: 0, embed: 0, rerank: 0, queryExpansion: 0 });
}

/** Force flush pending tokens to disk (call on shutdown). */
export function flushTokens(): void {
  flush();
}
