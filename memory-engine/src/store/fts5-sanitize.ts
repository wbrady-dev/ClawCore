/**
 * Sanitize a user-provided query for use in an FTS5 MATCH expression.
 *
 * FTS5 treats certain characters as operators:
 *   - `-` (NOT), `+` (required), `*` (prefix), `^` (initial token)
 *   - `OR`, `AND`, `NOT` (boolean operators)
 *   - `:` (column filter — e.g. `agent:foo` means "search column agent")
 *   - `"` (phrase query), `(` `)` (grouping)
 *   - `NEAR` (proximity)
 *
 * If the query contains any of these, naive MATCH will either error
 * ("no such column") or return unexpected results.
 *
 * Strategy: wrap each whitespace-delimited token in double quotes so FTS5
 * treats it as a literal phrase token. Internal double quotes are stripped.
 * Empty tokens are dropped. Tokens are joined with spaces (implicit AND).
 *
 * Examples:
 *   "sub-agent restrict"  →  '"sub-agent" "restrict"'
 *   "cc_expand OR crash" →  '"cc_expand" "OR" "crash"'
 *   'hello "world"'       →  '"hello" "world"'
 */
export function sanitizeFts5Query(raw: string): string | null {
  const tokens = raw
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => t.replace(/"/g, ""))
    .filter((t) => t.length > 0);
  if (tokens.length === 0) {
    return null;
  }
  return tokens.map((t) => `"${t}"`).join(" ");
}

/**
 * Relaxed FTS5 query — uses OR between tokens instead of AND.
 * Used as a fallback when strict AND returns zero results.
 * Any single matching token will surface a result.
 */
export function sanitizeFts5QueryOr(raw: string): string | null {
  const tokens = raw
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => t.replace(/"/g, ""))
    .filter((t) => t.length > 0);
  if (tokens.length === 0) {
    return null;
  }
  return tokens.map((t) => `"${t}"`).join(" OR ");
}

/** The number of tokens above which strict AND is likely too restrictive. */
export const FTS_RELAXATION_THRESHOLD = 2;

/**
 * FTS5 prefix query — appends * to the last token for prefix matching.
 * Used for single-token queries where strict match may miss partial words.
 * Only applies prefix to tokens >= 3 characters to avoid overly broad results.
 */
export function sanitizeFts5QueryPrefix(raw: string): string | null {
  const tokens = raw
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => t.replace(/"/g, ""))
    .filter((t) => t.length > 0);
  if (tokens.length === 0) return null;
  const last = tokens[tokens.length - 1];
  // Short tokens: fall back to exact match (prefix too broad for 1-2 char tokens)
  if (last.length < 3) return sanitizeFts5Query(raw);
  const parts = tokens.slice(0, -1).map((t) => `"${t}"`);
  parts.push(`"${last}"*`);
  return parts.join(" ");
}
