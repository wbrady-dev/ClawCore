/**
 * Terms list loader for entity extraction.
 *
 * Loads and validates `~/.threadclaw/relations-terms.json`.
 * Terms are cached for 60 seconds. Missing file returns [].
 */

import { readFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const MAX_TERMS = 500;
const MAX_TERM_LENGTH = 100;
/** Allow Unicode letters, digits, whitespace, and a small set of safe punctuation. */
const VALID_TERM_RE = /^[\p{L}\p{N}\s\-_.'"]+$/u;

function isValidTerm(term: string): boolean {
  if (typeof term !== "string") return false;
  const trimmed = term.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_TERM_LENGTH) return false;
  return VALID_TERM_RE.test(trimmed);
}

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

const CACHE_TTL_MS = 60_000;

let cachedTerms: string[] | null = null;
let cachedAt = 0;
let cachedPath: string | null = null;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Load terms from the terms file. Cached for 60 seconds.
 *
 * @param termsPath - Override path (defaults to `~/.threadclaw/relations-terms.json`).
 * @returns Array of validated terms (may be empty).
 */
export function loadTerms(termsPath?: string): string[] {
  const resolvedPath = termsPath ?? join(homedir(), ".threadclaw", "relations-terms.json");

  // Return cache if valid
  if (
    cachedTerms !== null &&
    cachedPath === resolvedPath &&
    Date.now() - cachedAt < CACHE_TTL_MS
  ) {
    return cachedTerms;
  }

  let terms: string[] = [];
  try {
    const raw = readFileSync(resolvedPath, "utf-8");
    const parsed = JSON.parse(raw);
    if (parsed && Array.isArray(parsed.terms)) {
      terms = parsed.terms
        .filter(isValidTerm)
        .map((t: string) => t.trim())
        .slice(0, MAX_TERMS);
    }
  } catch {
    // File doesn't exist or is invalid — return empty
    terms = [];
  }

  cachedTerms = terms;
  cachedAt = Date.now();
  cachedPath = resolvedPath;
  return terms;
}

/**
 * Clear the terms cache (useful for tests).
 */
export function clearTermsCache(): void {
  cachedTerms = null;
  cachedAt = 0;
  cachedPath = null;
}
