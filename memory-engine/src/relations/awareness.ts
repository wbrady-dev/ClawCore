/**
 * Awareness layer — builds contextual notes from the entity graph
 * to inject into the system prompt.
 *
 * Three query types (each with post-hoc 25ms budget guard):
 * 1. Mismatch: entities with divergent context_terms across sources
 * 2. Staleness: entities not seen in staleDays
 * 3. Connections: co-occurring entities across sources
 *
 * Note: budget guards truncate results after query completion — they do NOT
 * cancel synchronous SQLite queries mid-execution. On large graphs, individual
 * queries may exceed the 25ms target before truncation kicks in.
 *
 * All operations are non-fatal — errors return null.
 */

import type { GraphDb } from "./types.js";
import { effectiveConfidence } from "./confidence.js";
import { recordAwarenessEvent } from "./eval.js";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface AwarenessConfig {
  maxNotes: number;
  maxTokens: number;
  staleDays: number;
  minMentions: number;
  /** Reserved for future unseen-doc surfacing fallback (not yet implemented). */
  docSurfacing: boolean;
  /** Number of recent messages to scan for entity mentions (default 3). */
  messageLookback?: number;
  knowledgeApiUrl?: string;
}

// ---------------------------------------------------------------------------
// Entity name cache (top 5000 by mention_count, rebuilt every 30s)
// ---------------------------------------------------------------------------

interface EntityCacheEntry {
  id: number;
  name: string;
  mention_count: number;
}

const CACHE_MAX_SIZE = 5000;
const CACHE_TTL_MS = 30_000;

let entityCache: EntityCacheEntry[] = [];
let cacheBuiltAt = 0;

function rebuildEntityCache(db: GraphDb): EntityCacheEntry[] {
  if (Date.now() - cacheBuiltAt < CACHE_TTL_MS && entityCache.length > 0) {
    return entityCache;
  }
  try {
    entityCache = db.prepare(
      "SELECT id, name, mention_count FROM entities ORDER BY mention_count DESC LIMIT ?",
    ).all(CACHE_MAX_SIZE) as EntityCacheEntry[];
    cacheBuiltAt = Date.now();
  } catch {
    // Non-fatal — use stale cache
  }
  return entityCache;
}

/** Exported for tests. */
export function resetEntityCacheForTests(): void {
  entityCache = [];
  cacheBuiltAt = 0;
}

/** Invalidate the awareness entity cache so it rebuilds on next query. */
export function invalidateAwarenessCache(): void {
  entityCache = [];
  cacheBuiltAt = 0;
}

// ---------------------------------------------------------------------------
// Text extraction from agent messages
// ---------------------------------------------------------------------------

/**
 * Extract plain text from an agent message.
 * Handles both string content and array-of-blocks content.
 */
export function extractTextFromAgentMessage(msg: unknown): string {
  if (!msg || typeof msg !== "object") return "";
  const m = msg as Record<string, unknown>;
  if (typeof m.content === "string") return m.content;
  if (Array.isArray(m.content)) {
    return m.content
      .filter((b: unknown) => typeof b === "object" && b !== null && (b as Record<string, unknown>).type === "text")
      .map((b: unknown) => ((b as Record<string, unknown>).text as string) ?? "")
      .join(" ");
  }
  return "";
}

/**
 * Find known entity names that appear in text using word-boundary matching.
 * Avoids false positives like "red" matching inside "scored".
 */
function extractKeyTerms(text: string, cache: EntityCacheEntry[]): EntityCacheEntry[] {
  if (!text || cache.length === 0) return [];
  const lowerText = text.toLowerCase();
  return cache.filter((e) => {
    // Quick substring pre-check before regex (fast path for non-matches)
    if (!lowerText.includes(e.name)) return false;
    // Word-boundary check using pre-compiled regex (avoids new RegExp per entity per call)
    if (!(e as EntityCacheEntryWithRegex)._regex) {
      const escaped = e.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      (e as EntityCacheEntryWithRegex)._regex = new RegExp(`\\b${escaped}\\b`);
    }
    return (e as EntityCacheEntryWithRegex)._regex!.test(lowerText);
  });
}

interface EntityCacheEntryWithRegex extends EntityCacheEntry {
  _regex?: RegExp;
}

// ---------------------------------------------------------------------------
// Query: Mismatch detection
// ---------------------------------------------------------------------------

interface MismatchNote {
  entity: string;
  sourceA: string;
  termsA: string[];
  sourceB: string;
  termsB: string[];
}

function queryMismatches(db: GraphDb, entityIds: number[], limit: number): MismatchNote[] {
  if (entityIds.length === 0) return [];
  const placeholders = entityIds.map(() => "?").join(",");

  // Path 1: divergent context_terms between mentions from different sources
  const termRows = db.prepare(`
    SELECT
      e.display_name AS entity_name,
      m1.source_type || ':' || m1.source_id AS source_a,
      m1.context_terms AS terms_a,
      m2.source_type || ':' || m2.source_id AS source_b,
      m2.context_terms AS terms_b
    FROM entity_mentions m1
    JOIN entity_mentions m2 ON m1.entity_id = m2.entity_id AND m1.id < m2.id
    JOIN entities e ON m1.entity_id = e.id
    WHERE e.id IN (${placeholders})
      AND m1.context_terms IS NOT NULL AND m1.context_terms != '[]'
      AND m2.context_terms IS NOT NULL AND m2.context_terms != '[]'
      AND m1.context_terms != m2.context_terms
      AND m1.source_id != m2.source_id
      AND m1.created_at > datetime('now', '-90 days')
      AND m2.created_at > datetime('now', '-90 days')
    ORDER BY m2.created_at DESC
    LIMIT ?
  `).all(...entityIds, limit) as Array<{
    entity_name: string;
    source_a: string;
    terms_a: string;
    source_b: string;
    terms_b: string;
  }>;

  // Path 2: entities mentioned in 2+ distinct sources (even without terms)
  const remaining = limit - termRows.length;
  let sourceRows: typeof termRows = [];
  if (remaining > 0) {
    sourceRows = db.prepare(`
      SELECT
        e.display_name AS entity_name,
        MIN(m1.source_type || ':' || m1.source_id) AS source_a,
        NULL AS terms_a,
        MAX(m2.source_type || ':' || m2.source_id) AS source_b,
        NULL AS terms_b
      FROM entity_mentions m1
      JOIN entity_mentions m2 ON m1.entity_id = m2.entity_id AND m1.id < m2.id
      JOIN entities e ON m1.entity_id = e.id
      WHERE e.id IN (${placeholders})
        AND m1.source_id != m2.source_id
        AND m1.created_at > datetime('now', '-90 days')
      GROUP BY e.id
      LIMIT ?
    `).all(...entityIds, remaining) as typeof termRows;
  }

  // Deduplicate: exclude entities already covered by term-based mismatches
  const termEntityNames = new Set(termRows.map((r) => r.entity_name));
  const dedupedSourceRows = sourceRows.filter((r) => !termEntityNames.has(r.entity_name));

  return [...termRows, ...dedupedSourceRows].map((r) => ({
    entity: r.entity_name,
    sourceA: r.source_a,
    termsA: safeParse(r.terms_a),
    sourceB: r.source_b,
    termsB: safeParse(r.terms_b),
  }));
}

// ---------------------------------------------------------------------------
// Query: Staleness detection
// ---------------------------------------------------------------------------

interface StalenessNote {
  entity: string;
  lastSeen: string;
  daysSince: number;
}

function queryStaleness(db: GraphDb, entityIds: number[], staleDays: number, limit: number): StalenessNote[] {
  if (entityIds.length === 0) return [];
  const placeholders = entityIds.map(() => "?").join(",");
  const rows = db.prepare(`
    SELECT
      display_name,
      last_seen_at,
      CAST(julianday('now') - julianday(last_seen_at) AS INTEGER) AS days_since
    FROM entities
    WHERE id IN (${placeholders})
      AND CAST(julianday('now') - julianday(last_seen_at) AS INTEGER) >= ?
    ORDER BY days_since DESC
    LIMIT ?
  `).all(...entityIds, staleDays, limit) as Array<{
    display_name: string;
    last_seen_at: string;
    days_since: number;
  }>;

  return rows.map((r) => ({
    entity: r.display_name,
    lastSeen: r.last_seen_at,
    daysSince: r.days_since,
  }));
}

// ---------------------------------------------------------------------------
// Query: Connections (co-occurring entities)
// ---------------------------------------------------------------------------

interface ConnectionNote {
  entityA: string;
  entityB: string;
  sharedSource: string;
}

function queryConnections(db: GraphDb, entityIds: number[], limit: number): ConnectionNote[] {
  if (entityIds.length < 2) return [];
  const placeholders = entityIds.map(() => "?").join(",");
  const rows = db.prepare(`
    SELECT
      e1.display_name AS entity_a,
      e2.display_name AS entity_b,
      m1.source_type || ':' || m1.source_id AS shared_source
    FROM entity_mentions m1
    JOIN entity_mentions m2 ON m1.source_id = m2.source_id
      AND m1.source_type = m2.source_type
      AND m1.entity_id < m2.entity_id
    JOIN entities e1 ON m1.entity_id = e1.id
    JOIN entities e2 ON m2.entity_id = e2.id
    WHERE m1.entity_id IN (${placeholders})
      AND m2.entity_id IN (${placeholders})
    GROUP BY e1.id, e2.id
    ORDER BY COUNT(*) DESC
    LIMIT ?
  `).all(...entityIds, ...entityIds, limit) as Array<{
    entity_a: string;
    entity_b: string;
    shared_source: string;
  }>;

  return rows.map((r) => ({
    entityA: r.entity_a,
    entityB: r.entity_b,
    sharedSource: r.shared_source,
  }));
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function safeParse(json: string | null): string[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function estimateTokens(text: string): number {
  // Type-aware estimation: code/JSON ~3 chars/token, prose ~4 chars/token
  // Detect dominant type by sampling first 200 chars
  const sample = text.slice(0, 200);
  const codeSignals = (sample.match(/[{}\[\]();=<>]/g) || []).length;
  const ratio = codeSignals > 10 ? 3 : codeSignals > 5 ? 3.5 : 4;
  return Math.ceil(text.length / ratio);
}

/**
 * Run a query and truncate results if it exceeded the time budget.
 * Note: this does NOT cancel the query — SQLite queries run synchronously.
 * It only truncates results after completion to limit downstream processing.
 */
function withBudgetGuard<T>(fn: () => T[], budgetMs: number): T[] {
  const start = Date.now();
  try {
    const result = fn();
    if (Date.now() - start > budgetMs) {
      return result.slice(0, 1); // Truncate if over budget
    }
    return result;
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Format notes
// ---------------------------------------------------------------------------

function formatMismatch(note: MismatchNote): string {
  const diffA = note.termsA.filter((t) => !note.termsB.includes(t));
  const diffB = note.termsB.filter((t) => !note.termsA.includes(t));
  return `Possible mismatch: "${note.entity}" — ${note.sourceA} mentions [${diffA.join(", ")}] but ${note.sourceB} mentions [${diffB.join(", ")}]`;
}

function formatStaleness(note: StalenessNote): string {
  return `Stale reference: "${note.entity}" last seen ${note.daysSince} days ago (${note.lastSeen})`;
}

function formatConnection(note: ConnectionNote): string {
  return `Connection: "${note.entityA}" and "${note.entityB}" co-occur in ${note.sharedSource}`;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Build awareness notes from the entity graph based on the current turn's messages.
 *
 * @returns Awareness note text to append to system prompt, or null if nothing to surface.
 */
export function buildAwarenessNote(
  messages: unknown[],
  db: GraphDb,
  config: AwarenessConfig,
): string | null {
  const start = Date.now();
  const noteLines: string[] = [];
  const noteTypes: string[] = [];

  try {
    // Extract text from recent messages for entity detection
    const lookback = config.messageLookback ?? 3;
    const recentMessages = messages.slice(-lookback);
    const text = recentMessages.map(extractTextFromAgentMessage).join(" ");
    if (!text.trim()) {
      recordAwarenessEvent({ fired: false, noteCount: 0, noteTypes: [], latencyMs: 0, terms: [], tokensAdded: 0 });
      return null;
    }

    // Find known entities in current turn
    const cache = rebuildEntityCache(db);
    const matchedEntities = extractKeyTerms(text, cache);
    const matchedIds = matchedEntities
      .filter((e) => e.mention_count >= config.minMentions)
      .map((e) => e.id);
    const terms = matchedEntities.map((e) => e.name);

    if (matchedIds.length === 0) {
      recordAwarenessEvent({
        fired: false, noteCount: 0, noteTypes: [], latencyMs: Date.now() - start, terms, tokensAdded: 0,
      });
      return null;
    }

    // Reserve tokens for header "[ClawCore Awareness]\n"
    const headerTokens = estimateTokens("[ClawCore Awareness]\n");
    let tokenBudget = config.maxTokens - headerTokens;

    // Query 1: Mismatches (25ms guard)
    const mismatches = withBudgetGuard(
      () => queryMismatches(db, matchedIds, config.maxNotes),
      25,
    );
    for (const m of mismatches) {
      if (noteLines.length >= config.maxNotes) break;
      const line = formatMismatch(m);
      const cost = estimateTokens(line);
      if (cost > tokenBudget) continue;
      noteLines.push(line);
      noteTypes.push("mismatch");
      tokenBudget -= cost;
    }

    // Query 2: Staleness (25ms guard)
    const stale = withBudgetGuard(
      () => queryStaleness(db, matchedIds, config.staleDays, config.maxNotes),
      25,
    );
    for (const s of stale) {
      if (noteLines.length >= config.maxNotes) break;
      const line = formatStaleness(s);
      const cost = estimateTokens(line);
      if (cost > tokenBudget) continue;
      noteLines.push(line);
      noteTypes.push("staleness");
      tokenBudget -= cost;
    }

    // Query 3: Connections (25ms guard)
    const connections = withBudgetGuard(
      () => queryConnections(db, matchedIds, config.maxNotes),
      25,
    );
    for (const c of connections) {
      if (noteLines.length >= config.maxNotes) break;
      const line = formatConnection(c);
      const cost = estimateTokens(line);
      if (cost > tokenBudget) continue;
      noteLines.push(line);
      noteTypes.push("connection");
      tokenBudget -= cost;
    }

    // TODO: implement doc surfacing — surface unseen documents relevant to current entities
    // when config.docSurfacing is true (config plumbing already in place)

    const latencyMs = Date.now() - start;
    const tokensAdded = config.maxTokens - tokenBudget;

    if (noteLines.length === 0) {
      recordAwarenessEvent({
        fired: false, noteCount: 0, noteTypes: [], latencyMs, terms, tokensAdded: 0,
      });
      return null;
    }

    recordAwarenessEvent({
      fired: true,
      noteCount: noteLines.length,
      noteTypes,
      latencyMs,
      terms,
      tokensAdded,
    });

    return `[ClawCore Awareness]\n${noteLines.join("\n")}`;
  } catch {
    recordAwarenessEvent({
      fired: false, noteCount: 0, noteTypes: [], latencyMs: Date.now() - start, terms: [], tokensAdded: 0,
    });
    return null;
  }
}
