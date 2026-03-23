/**
 * MemoryReader — unified read layer across all 3 stores.
 *
 * Normalizes rows from graph.db into MemoryObject format with
 * relevance-to-action ranking.
 *
 * Phase 1 (current): reads claim, decision, entity, loop, attempt, procedure, invariant
 * Phase 3 (pending): adds message, summary from memory.db; chunk from clawcore.db
 * Not yet implemented: conflict, delta, event (no backing tables yet)
 */

import type { GraphDb } from "../relations/types.js";
import type {
  MemoryObject,
  MemoryKind,
  MemoryStatus,
  SourceKind,
  RelevanceSignals,
  TaskMode,
} from "./types.js";
import {
  computeRelevance,
  TASK_MODE_WEIGHTS,
  INFLUENCE_SCORES,
  SOURCE_TRUST,
} from "./types.js";
import { buildCanonicalKey } from "./canonical.js";

// ── Query Options ───────────────────────────────────────────────────────────

export interface MemoryReaderOptions {
  /** Filter by one or more MemoryKind values. */
  kinds?: MemoryKind[];
  /** Filter by scope. Default: 1 (global). */
  scopeId?: number;
  /** Filter by status. Default: ['active']. */
  statuses?: MemoryStatus[];
  /** Maximum results to return. Default: 50. */
  limit?: number;
  /** Task mode for ranking weights. Default: 'default'. */
  taskMode?: TaskMode;
  /** Optional keyword for basic text matching (LIKE %keyword%). */
  keyword?: string;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

const HALF_LIFE_DAYS = 30;

const VALID_SOURCE_KINDS = new Set<string>([
  "document", "message", "tool_result", "user_explicit",
  "extraction", "compaction", "inference",
]);

function freshnessDecay(isoDate: string | null): number {
  if (!isoDate) return 0.5;
  try {
    const daysOld = (Date.now() - new Date(isoDate).getTime()) / 86_400_000;
    if (daysOld < 0) return 1.0; // Future date — treat as maximally fresh
    return Math.max(0.1, 1 - (daysOld / HALF_LIFE_DAYS));
  } catch {
    return 0.5;
  }
}

function statusPenalty(status: string): number {
  switch (status) {
    case "active": return 1.0;
    case "needs_confirmation": return 0.9;
    case "stale": return 0.3;
    case "superseded":
    case "retracted": return 0.0;
    default: return 0.5;
  }
}

function isoNow(): string {
  return new Date().toISOString();
}

function safeStr(val: unknown, fallback = ""): string {
  return typeof val === "string" ? val : fallback;
}

function safeNum(val: unknown, fallback: number): number {
  const n = Number(val);
  return Number.isFinite(n) ? n : fallback;
}

function clampTrust(val: unknown): number {
  return Math.min(1.0, Math.max(0.0, safeNum(val, 0.5)));
}

function validSourceKind(val: unknown): SourceKind {
  const s = typeof val === "string" ? val : "";
  return VALID_SOURCE_KINDS.has(s) ? (s as SourceKind) : "extraction";
}

/** Escape LIKE wildcards for safe pattern matching. */
function escapeLike(keyword: string): string {
  return keyword.replace(/[%_\\]/g, "\\$&");
}

// ── Row Normalizers ─────────────────────────────────────────────────────────

function claimToMemoryObject(row: Record<string, unknown>): MemoryObject {
  return {
    id: `claim:${row.id}`,
    kind: "claim",
    content: `${safeStr(row.subject, "(unknown)")} ${safeStr(row.predicate, "(unknown)")}: ${safeStr(row.object_text, "(no value)")}`,
    structured: {
      subject: row.subject,
      predicate: row.predicate,
      objectText: row.object_text,
      objectJson: row.object_json,
      valueType: row.value_type,
    },
    canonical_key: buildCanonicalKey("claim", "", { subject: row.subject, predicate: row.predicate }),
    provenance: {
      source_kind: "extraction",
      source_id: String(row.id),
      actor: "system",
      trust: clampTrust(row.trust_score),
    },
    confidence: clampTrust(row.confidence),
    freshness: freshnessDecay(safeStr(row.last_seen_at) || null),
    provisional: false,
    status: (row.status as MemoryStatus) ?? "active",
    superseded_by: row.superseded_by ? `claim:${row.superseded_by}` : undefined,
    observed_at: safeStr(row.first_seen_at) || isoNow(),
    scope_id: safeNum(row.scope_id, 1),
    influence_weight: "standard",
    created_at: safeStr(row.created_at) || isoNow(),
    updated_at: safeStr(row.updated_at) || safeStr(row.created_at) || isoNow(),
  };
}

function decisionToMemoryObject(row: Record<string, unknown>): MemoryObject {
  return {
    id: `decision:${row.id}`,
    kind: "decision",
    content: `${safeStr(row.topic, "(no topic)")}: ${safeStr(row.decision_text, "(no text)")}`,
    structured: { topic: row.topic, decisionText: row.decision_text },
    canonical_key: buildCanonicalKey("decision", "", { topic: row.topic ? String(row.topic) : undefined }),
    provenance: {
      source_kind: validSourceKind(row.source_type),
      source_id: safeStr(row.source_id) || String(row.id),
      actor: "system",
      trust: SOURCE_TRUST.user_explicit,
    },
    confidence: 0.9,
    freshness: freshnessDecay(safeStr(row.decided_at) || null),
    provisional: false,
    status: (row.status as MemoryStatus) ?? "active",
    superseded_by: row.superseded_by ? `decision:${row.superseded_by}` : undefined,
    observed_at: safeStr(row.decided_at) || isoNow(),
    scope_id: safeNum(row.scope_id, 1),
    influence_weight: "high",
    created_at: safeStr(row.created_at) || isoNow(),
    updated_at: safeStr(row.decided_at) || safeStr(row.created_at) || isoNow(),
  };
}

function entityToMemoryObject(row: Record<string, unknown>): MemoryObject {
  const content = safeStr(row.display_name) || safeStr(row.name) || "";
  return {
    id: `entity:${row.id}`,
    kind: "entity",
    content,
    structured: {
      name: row.name,
      displayName: row.display_name,
      entityType: row.entity_type,
      mentionCount: row.mention_count,
    },
    canonical_key: buildCanonicalKey("entity", safeStr(row.name)),
    provenance: {
      source_kind: "extraction",
      source_id: String(row.id),
      actor: "system",
      trust: 0.6,
    },
    confidence: Math.min(1.0, 0.4 + Math.log10(Math.max(1, safeNum(row.mention_count, 1))) * 0.15),
    freshness: freshnessDecay(safeStr(row.last_seen_at) || null),
    provisional: false,
    status: "active",
    observed_at: safeStr(row.first_seen_at) || isoNow(),
    scope_id: 1,
    influence_weight: "standard",
    created_at: safeStr(row.first_seen_at) || isoNow(),
    updated_at: safeStr(row.last_seen_at) || isoNow(),
  };
}

function mapLoopStatusToMemoryStatus(loopStatus: string | undefined): MemoryStatus {
  switch (loopStatus) {
    case "open":
    case "blocked": return "active";
    case "closed": return "superseded";
    case "stale": return "stale";
    default: return "active";
  }
}

function loopToMemoryObject(row: Record<string, unknown>): MemoryObject {
  const content = safeStr(row.text);
  return {
    id: `loop:${row.id}`,
    kind: "loop",
    content,
    structured: {
      loopType: row.loop_type,
      priority: row.priority,
      owner: row.owner,
      dueAt: row.due_at,
      waitingOn: row.waiting_on,
    },
    canonical_key: buildCanonicalKey("loop", content),
    provenance: {
      source_kind: validSourceKind(row.source_type),
      source_id: safeStr(row.source_id) || String(row.id),
      actor: "system",
      trust: SOURCE_TRUST.user_explicit,
    },
    confidence: 0.8,
    freshness: freshnessDecay(safeStr(row.opened_at) || null),
    provisional: false,
    status: mapLoopStatusToMemoryStatus(row.status as string),
    observed_at: safeStr(row.opened_at) || isoNow(),
    scope_id: safeNum(row.scope_id, 1),
    influence_weight: safeNum(row.priority, 0) >= 7 ? "high" : "standard",
    created_at: safeStr(row.opened_at) || isoNow(),
    updated_at: safeStr(row.closed_at) || safeStr(row.opened_at) || isoNow(),
  };
}

function attemptToMemoryObject(row: Record<string, unknown>): MemoryObject {
  return {
    id: `attempt:${row.id}`,
    kind: "attempt",
    content: `${safeStr(row.tool_name, "(unknown)")}: ${safeStr(row.status as string, "unknown")}${row.error_text ? ` — ${row.error_text}` : ""}`,
    structured: {
      toolName: row.tool_name,
      inputSummary: row.input_summary,
      outputSummary: row.output_summary,
      status: row.status,
      durationMs: row.duration_ms,
      errorText: row.error_text,
    },
    provenance: {
      source_kind: "tool_result",
      source_id: String(row.id),
      actor: "system",
      trust: SOURCE_TRUST.tool_result,
    },
    confidence: 1.0,
    freshness: freshnessDecay(safeStr(row.created_at) || null),
    provisional: false,
    status: "active", // Attempts are append-only historical fact
    observed_at: safeStr(row.created_at) || isoNow(),
    scope_id: safeNum(row.scope_id, 1),
    influence_weight: (row.status === "failure") ? "high" : "standard",
    created_at: safeStr(row.created_at) || isoNow(),
    updated_at: safeStr(row.created_at) || isoNow(), // Attempts don't change
  };
}

function procedureToMemoryObject(row: Record<string, unknown>): MemoryObject {
  const isAnti = "failure_pattern" in row;
  const pattern = safeStr(isAnti ? row.failure_pattern : row.pattern);
  const toolName = safeStr(row.tool_name);
  const key = safeStr(isAnti ? row.anti_runbook_key : row.runbook_key);
  return {
    id: `procedure:${row.id}`,
    kind: "procedure",
    content: isAnti
      ? `[AVOID] ${toolName}: ${pattern}`
      : `[DO] ${toolName}: ${pattern}`,
    structured: {
      toolName,
      key,
      pattern,
      description: row.description,
      isNegative: isAnti,
      successCount: row.success_count,
      failureCount: row.failure_count,
    },
    canonical_key: buildCanonicalKey("procedure", "", { toolName, key }),
    provenance: {
      source_kind: "extraction",
      source_id: String(row.id),
      actor: "system",
      trust: clampTrust(row.confidence),
    },
    confidence: clampTrust(row.confidence),
    freshness: freshnessDecay(safeStr(row.updated_at) || null),
    provisional: false,
    status: (row.status as MemoryStatus) ?? "active",
    observed_at: safeStr(row.created_at) || isoNow(),
    scope_id: safeNum(row.scope_id, 1),
    influence_weight: isAnti ? "high" : "standard",
    created_at: safeStr(row.created_at) || isoNow(),
    updated_at: safeStr(row.updated_at) || isoNow(),
  };
}

function invariantToMemoryObject(row: Record<string, unknown>): MemoryObject {
  return {
    id: `invariant:${row.id}`,
    kind: "invariant",
    content: `[${safeStr(row.severity, "warning")}] ${safeStr(row.description)}`,
    structured: {
      key: row.invariant_key,
      category: row.category,
      severity: row.severity,
      enforcementMode: row.enforcement_mode,
    },
    canonical_key: buildCanonicalKey("invariant", "", { key: safeStr(row.invariant_key) }),
    provenance: {
      source_kind: validSourceKind(row.source_type),
      source_id: safeStr(row.source_id) || String(row.id),
      actor: "system",
      trust: 0.9,
    },
    confidence: 0.9,
    freshness: freshnessDecay(safeStr(row.updated_at) || null),
    provisional: false,
    status: (row.status as MemoryStatus) ?? "active",
    observed_at: safeStr(row.created_at) || isoNow(),
    scope_id: safeNum(row.scope_id, 1),
    influence_weight: (row.severity === "critical" || row.severity === "error") ? "critical" : "high",
    created_at: safeStr(row.created_at) || isoNow(),
    updated_at: safeStr(row.updated_at) || isoNow(),
  };
}

// ── Kind-to-query mapping ───────────────────────────────────────────────────

interface KindQuery {
  table: string;
  statusColumn?: string;
  contentColumn: string; // column for keyword LIKE search
  normalizer: (row: Record<string, unknown>) => MemoryObject;
}

/**
 * Map MemoryStatus values to actual column values per kind.
 * Loops use "open"/"closed"/"blocked"/"stale" instead of "active"/"superseded".
 */
function mapStatusValues(kind: MemoryKind, statuses: MemoryStatus[]): string[] {
  if (kind === "loop") {
    return statuses.flatMap((s) => {
      if (s === "active") return ["open", "blocked"];
      if (s === "superseded") return ["closed"];
      return [s];
    });
  }
  return statuses;
}

const KIND_QUERIES: Partial<Record<MemoryKind, KindQuery>> = {
  claim:     { table: "claims",      statusColumn: "status", contentColumn: "object_text",      normalizer: claimToMemoryObject },
  decision:  { table: "decisions",   statusColumn: "status", contentColumn: "decision_text",    normalizer: decisionToMemoryObject },
  entity:    { table: "entities",    contentColumn: "name",            normalizer: entityToMemoryObject },
  loop:      { table: "open_loops",  statusColumn: "status", contentColumn: "text",             normalizer: loopToMemoryObject },
  attempt:   { table: "attempts",    contentColumn: "tool_name",       normalizer: attemptToMemoryObject },
  procedure: { table: "runbooks",    statusColumn: "status", contentColumn: "pattern",          normalizer: procedureToMemoryObject },
  invariant: { table: "invariants",  statusColumn: "status", contentColumn: "description",      normalizer: invariantToMemoryObject },
};

/** Anti-runbooks are a second table for the "procedure" kind. Queried alongside runbooks. */
const ANTI_RUNBOOK_QUERY: KindQuery = {
  table: "anti_runbooks", statusColumn: "status", contentColumn: "failure_pattern", normalizer: procedureToMemoryObject,
};

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Query the graph database and return normalized MemoryObjects.
 *
 * Results are ranked by relevance-to-action using the specified task mode.
 */
export function readMemoryObjects(
  db: GraphDb,
  options: MemoryReaderOptions = {},
): MemoryObject[] {
  const {
    kinds,
    scopeId = 1,
    statuses = ["active"],
    limit = 50,
    taskMode = "default",
    keyword,
  } = options;

  const weights = TASK_MODE_WEIGHTS[taskMode] ?? TASK_MODE_WEIGHTS.default;
  const targetKinds = kinds ?? (Object.keys(KIND_QUERIES) as MemoryKind[]);
  const allObjects: MemoryObject[] = [];

  /** Run a single kind-query against a table, appending results to allObjects. */
  function queryTable(kind: MemoryKind, kq: KindQuery): void {
    try {
      let sql = `SELECT * FROM ${kq.table} WHERE 1=1`;
      const params: unknown[] = [];

      // Scope filter (entities don't have scope_id)
      if (kind !== "entity") {
        sql += ` AND scope_id = ?`;
        params.push(scopeId);
      }

      // Status filter (mapped per-kind)
      if (kq.statusColumn && statuses.length > 0) {
        const mapped = mapStatusValues(kind, statuses);
        if (mapped.length > 0) {
          sql += ` AND ${kq.statusColumn} IN (${mapped.map(() => "?").join(",")})`;
          params.push(...mapped);
        }
      }

      // Keyword filter with LIKE wildcard escaping
      if (keyword) {
        const escaped = escapeLike(keyword);
        sql += ` AND ${kq.contentColumn} LIKE ? ESCAPE '\\'`;
        params.push(`%${escaped}%`);
      }

      // Fetch more than requested to allow ranking to reorder before slicing
      sql += ` LIMIT ?`;
      params.push(limit * 3);

      const rows = db.prepare(sql).all(...params) as Record<string, unknown>[];
      for (const row of rows) {
        allObjects.push(kq.normalizer(row));
      }
    } catch {
      // Non-fatal: skip if table doesn't exist or query fails
    }
  }

  for (const kind of targetKinds) {
    const kq = KIND_QUERIES[kind];
    if (!kq) continue;

    queryTable(kind, kq);

    // Procedures also include anti_runbooks (second table, same kind)
    if (kind === "procedure") {
      queryTable(kind, ANTI_RUNBOOK_QUERY);
    }
  }

  // Rank by relevance-to-action
  const scored = allObjects.map((obj) => {
    const signals: RelevanceSignals = {
      semantic: keyword ? 0.6 : 0.5, // Heuristic: keyword presence, not semantic depth
      recency: obj.freshness,
      trust: obj.provenance.trust,
      conflict: obj.status === "needs_confirmation" ? 1.0 : 0.0,
      influence: INFLUENCE_SCORES[obj.influence_weight] ?? 0.5,
      status_penalty: statusPenalty(obj.status),
    };
    return { obj, score: computeRelevance(signals, weights) };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((s) => s.obj);
}

/**
 * Read a single MemoryObject by its composite ID (e.g. "claim:42").
 */
export function readMemoryObjectById(
  db: GraphDb,
  compositeId: string,
): MemoryObject | undefined {
  const colonIdx = compositeId.indexOf(":");
  if (colonIdx < 0) return undefined;

  const kind = compositeId.substring(0, colonIdx) as MemoryKind;
  const rawId = compositeId.substring(colonIdx + 1);

  const kq = KIND_QUERIES[kind];
  if (!kq) return undefined;

  try {
    const row = db.prepare(`SELECT * FROM ${kq.table} WHERE id = ?`).get(rawId) as Record<string, unknown> | undefined;
    if (!row) return undefined;
    return kq.normalizer(row);
  } catch {
    return undefined;
  }
}

/**
 * Count MemoryObjects by kind for stats/diagnostics.
 * Uses single query per kind with CASE/WHEN for consistency.
 */
export function countMemoryObjects(
  db: GraphDb,
  scopeId: number = 1,
): Record<string, { total: number; active: number; stale: number; superseded: number; conflicts: number }> {
  const result: Record<string, { total: number; active: number; stale: number; superseded: number; conflicts: number }> = {};

  /** Count a single table with status breakdown. */
  function countTable(
    table: string,
    statusColumn: string | undefined,
    kind: MemoryKind,
  ): { total: number; active: number; stale: number; superseded: number; conflicts: number } {
    const hasScopeId = kind !== "entity";
    const hasStatus = !!statusColumn;
    const scopeClause = hasScopeId ? " WHERE scope_id = ?" : "";
    const scopeParams: unknown[] = hasScopeId ? [scopeId] : [];

    if (hasStatus) {
      const sc = statusColumn;
      const row = db.prepare(`
        SELECT
          COUNT(*) as total,
          SUM(CASE WHEN ${sc} = 'active'${kind === "loop" ? ` OR ${sc} = 'open' OR ${sc} = 'blocked'` : ""} THEN 1 ELSE 0 END) as active,
          SUM(CASE WHEN ${sc} = 'stale' THEN 1 ELSE 0 END) as stale,
          SUM(CASE WHEN ${sc} = 'superseded'${kind === "loop" ? ` OR ${sc} = 'closed'` : ""} THEN 1 ELSE 0 END) as superseded,
          SUM(CASE WHEN ${sc} = 'needs_confirmation' THEN 1 ELSE 0 END) as conflicts
        FROM ${table}${scopeClause}
      `).get(...scopeParams) as Record<string, number>;
      return {
        total: row.total ?? 0,
        active: row.active ?? 0,
        stale: row.stale ?? 0,
        superseded: row.superseded ?? 0,
        conflicts: row.conflicts ?? 0,
      };
    }
    const total = (db.prepare(
      `SELECT COUNT(*) as cnt FROM ${table}${scopeClause}`,
    ).get(...scopeParams) as { cnt: number }).cnt;
    return { total, active: total, stale: 0, superseded: 0, conflicts: 0 };
  }

  for (const [kind, kq] of Object.entries(KIND_QUERIES) as [MemoryKind, KindQuery][]) {
    try {
      const counts = countTable(kq.table, kq.statusColumn, kind);

      // Procedures: also count anti_runbooks and merge
      if (kind === "procedure") {
        try {
          const antiCounts = countTable(ANTI_RUNBOOK_QUERY.table, ANTI_RUNBOOK_QUERY.statusColumn, kind);
          counts.total += antiCounts.total;
          counts.active += antiCounts.active;
          counts.stale += antiCounts.stale;
          counts.superseded += antiCounts.superseded;
          counts.conflicts += antiCounts.conflicts;
        } catch { /* anti_runbooks table may not exist */ }
      }

      result[kind] = counts;
    } catch {
      result[kind] = { total: 0, active: 0, stale: 0, superseded: 0, conflicts: 0 };
    }
  }

  return result;
}
