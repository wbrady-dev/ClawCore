import type { GraphDb } from "./types.js";
import { getActiveInvariants } from "./invariant-store.js";

export interface InvariantViolation {
  invariantKey: string;
  description: string;
  severity: string;
  matchReason: string;
}

// Cache strict invariants per scope (30s TTL)
interface CacheEntry {
  invariants: Array<{ key: string; description: string; severity: string; forbidden: string[] }>;
  cacheTime: number;
}
const _scopeCache = new Map<number, CacheEntry>();
const CACHE_TTL = 30_000;

// Extract forbidden terms from invariant descriptions using negation patterns
const NEGATION_RE = /(?:never|do\s+not|must\s+not|don't|shouldn't|avoid|prohibited|forbidden|no)\s+(?:use\s+|using\s+)?(.+?)(?:\.|,|$)/gi;

function extractForbiddenTerms(description: string): string[] {
  const terms: string[] = [];
  let match: RegExpExecArray | null;
  const re = new RegExp(NEGATION_RE.source, NEGATION_RE.flags);
  while ((match = re.exec(description)) !== null) {
    const term = match[1].trim().toLowerCase();
    if (term.length >= 2 && term.length <= 60) {
      terms.push(term);
      // Also add stem variants (e.g., "MongoDB" -> "mongo")
      const stem = term.replace(/\s*(db|database|server|service|client|sdk)$/i, '').trim();
      if (stem.length >= 2 && stem !== term) terms.push(stem);
    }
  }
  return terms;
}

function refreshCache(db: GraphDb, scopeId: number): void {
  const entry = _scopeCache.get(scopeId);
  if (entry && Date.now() - entry.cacheTime < CACHE_TTL) return;
  const invariants = getActiveInvariants(db, scopeId);
  const allStrict = invariants
    .filter(inv => inv.enforcement_mode === 'strict')
    .map(inv => ({
      key: inv.invariant_key,
      description: inv.description,
      severity: inv.severity,
      forbidden: extractForbiddenTerms(inv.description),
    }));

  // Warn about strict invariants with no extractable forbidden terms (e.g. positive invariants)
  for (const inv of allStrict) {
    if (inv.forbidden.length === 0) {
      console.warn("[rsma] invariant has no extractable enforcement terms:", inv.description.slice(0, 80));
    }
  }

  _scopeCache.set(scopeId, {
    invariants: allStrict.filter(inv => inv.forbidden.length > 0),
    cacheTime: Date.now(),
  });
}

export function checkStrictInvariants(
  db: GraphDb,
  scopeId: number,
  content: string,
  structured: Record<string, unknown> | null,
): InvariantViolation[] {
  refreshCache(db, scopeId);
  const _cache = _scopeCache.get(scopeId)?.invariants ?? [];
  if (_cache.length === 0) return [];

  // Build normalized search text from content + structured fields
  const parts = [content];
  if (structured) {
    if (typeof structured.objectText === 'string') parts.push(structured.objectText);
    if (typeof structured.subject === 'string') parts.push(structured.subject);
    if (typeof structured.decisionText === 'string') parts.push(structured.decisionText);
    if (typeof structured.object === 'string') parts.push(structured.object);
  }
  // Normalize: NFKD decomposition, strip zero-width/control chars, lowercase
  const searchText = parts.join(' ')
    .normalize("NFKD")
    .replace(/[\u200B-\u200F\u2028-\u202F\uFEFF\u00AD]/g, "")
    .toLowerCase();

  const violations: InvariantViolation[] = [];
  for (const inv of _cache) {
    for (const term of inv.forbidden) {
      if (searchText.includes(term)) {
        violations.push({
          invariantKey: inv.key,
          description: inv.description,
          severity: inv.severity,
          matchReason: `Contains "${term}" which is forbidden by invariant "${inv.key}"`,
        });
        break; // One match per invariant is enough
      }
    }
  }
  return violations;
}

export function resetInvariantCacheForTests(): void {
  _scopeCache.clear();
}
