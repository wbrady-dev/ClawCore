/**
 * Fast entity extraction — regex-only, no LLM calls.
 *
 * Three strategies:
 * 1. Capitalized multi-word phrases (confidence 0.6)
 * 2. User-extensible terms list matches (confidence 0.9)
 * 3. Quoted terms (confidence 0.5)
 *
 * All names are lowercased + trimmed before deduplication.
 * When multiple strategies match the same name, the highest confidence wins.
 */

import type { ExtractionResult } from "./types.js";

// ---------------------------------------------------------------------------
// Common false-positive filters
// ---------------------------------------------------------------------------

const MONTH_NAMES = new Set([
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
]);

const COMMON_PHRASES = new Set([
  "the", "this", "that", "these", "those", "here", "there",
  "what", "which", "where", "when", "while", "because", "since",
  "however", "therefore", "although", "please", "thank",
]);

function isFalsePositiveCapitalized(name: string): boolean {
  const lower = name.toLowerCase();
  // Month-led phrases like "January Report"
  const firstWord = lower.split(/\s+/)[0] ?? "";
  if (MONTH_NAMES.has(firstWord)) return true;
  // Common sentence-starting phrases
  if (COMMON_PHRASES.has(firstWord)) return true;
  // Very short (< 4 chars total) — likely noise
  if (lower.length < 4) return true;
  return false;
}

function isFalsePositiveQuoted(text: string): boolean {
  // Filter paths, URLs, code fragments
  if (/^[/\\.]/.test(text)) return true;
  if (/^https?:\/\//.test(text)) return true;
  if (/^[{[<]/.test(text)) return true;
  if (/\.(ts|js|py|go|rs|json|yaml|yml|md|txt|html|css|sh)$/i.test(text)) return true;
  // Single words that are likely code identifiers (camelCase, snake_case)
  if (/^[a-z]+[A-Z]/.test(text)) return true;
  if (/^[a-z]+_[a-z]/.test(text)) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Snippet extraction
// ---------------------------------------------------------------------------

function extractSnippet(text: string, matchStart: number, matchEnd: number, maxLen = 200): string {
  const halfCtx = Math.floor((maxLen - (matchEnd - matchStart)) / 2);
  const start = Math.max(0, matchStart - halfCtx);
  const end = Math.min(text.length, matchEnd + halfCtx);
  let snippet = text.slice(start, end).trim();
  if (start > 0) snippet = "..." + snippet;
  if (end < text.length) snippet = snippet + "...";
  return snippet;
}

// ---------------------------------------------------------------------------
// Strategy 1: Capitalized multi-word phrases
// ---------------------------------------------------------------------------

const CAPITALIZED_RE = /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\b/g;

function extractCapitalized(text: string): ExtractionResult[] {
  const results: ExtractionResult[] = [];
  let match: RegExpExecArray | null;
  CAPITALIZED_RE.lastIndex = 0;
  while ((match = CAPITALIZED_RE.exec(text)) !== null) {
    const name = match[1]!;
    if (isFalsePositiveCapitalized(name)) continue;
    results.push({
      name,
      confidence: 0.6,
      strategy: "capitalized",
      entityType: "possible_name",
      snippet: extractSnippet(text, match.index, match.index + name.length),
    });
  }
  return results;
}

// ---------------------------------------------------------------------------
// Strategy 2: Terms-list matching
// ---------------------------------------------------------------------------

function extractTermsList(text: string, terms: string[]): ExtractionResult[] {
  if (terms.length === 0) return [];
  const results: ExtractionResult[] = [];
  const lowerText = text.toLowerCase();

  for (const term of terms) {
    const lowerTerm = term.toLowerCase().trim();
    if (lowerTerm.length === 0) continue;

    // Word-boundary aware search
    const escaped = lowerTerm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`\\b${escaped}\\b`, "gi");
    let match: RegExpExecArray | null;
    re.lastIndex = 0;
    // Record first occurrence only per term
    match = re.exec(lowerText);
    if (match) {
      results.push({
        name: term, // preserve original casing from terms list
        confidence: 0.9,
        strategy: "terms_list",
        entityType: "user_defined",
        snippet: extractSnippet(text, match.index, match.index + term.length),
      });
    }
  }
  return results;
}

// ---------------------------------------------------------------------------
// Strategy 3: Quoted terms
// ---------------------------------------------------------------------------

const QUOTED_RE = /[""\u201C]([^""\u201D]{2,50})[""\u201D]/g;

function extractQuoted(text: string): ExtractionResult[] {
  const results: ExtractionResult[] = [];
  let match: RegExpExecArray | null;
  QUOTED_RE.lastIndex = 0;
  while ((match = QUOTED_RE.exec(text)) !== null) {
    const inner = match[1]!.trim();
    if (inner.length < 2) continue;
    if (isFalsePositiveQuoted(inner)) continue;
    results.push({
      name: inner,
      confidence: 0.5,
      strategy: "quoted",
      entityType: "concept",
      snippet: extractSnippet(text, match.index, match.index + match[0].length),
    });
  }
  return results;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Extract entities from text using fast regex strategies.
 *
 * @param text - Source text to extract from.
 * @param termsListEntries - User-defined terms for high-confidence matching.
 * @returns Deduplicated extraction results (highest confidence per name).
 */
export function extractFast(
  text: string,
  termsListEntries?: string[],
): ExtractionResult[] {
  if (!text || text.length === 0) return [];

  const allResults: ExtractionResult[] = [
    ...extractCapitalized(text),
    ...extractTermsList(text, termsListEntries ?? []),
    ...extractQuoted(text),
  ];

  // Find all terms-list entries that appear in the text (for contextTerms)
  const presentTerms: string[] = [];
  if (termsListEntries && termsListEntries.length > 0) {
    const lowerText = text.toLowerCase();
    for (const term of termsListEntries) {
      if (lowerText.includes(term.toLowerCase().trim())) {
        presentTerms.push(term);
      }
    }
  }

  // Deduplicate by lowercased name — keep highest confidence
  const deduped = new Map<string, ExtractionResult>();
  for (const result of allResults) {
    const key = result.name.toLowerCase().trim();
    if (key.length === 0) continue;
    const existing = deduped.get(key);
    if (!existing || result.confidence > existing.confidence) {
      deduped.set(key, {
        ...result,
        contextTerms: presentTerms.length > 0 ? presentTerms : undefined,
      });
    }
  }

  return Array.from(deduped.values());
}
