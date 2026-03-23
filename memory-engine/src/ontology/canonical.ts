/**
 * Canonical Key Generation — core infrastructure for RSMA.
 *
 * Canonical keys determine what a MemoryObject is "about." Two objects sharing
 * a canonical key triggers the TruthEngine to decide their relationship
 * (supersession, conflict, or coexistence).
 *
 * Per-kind strategies — no universal formula. Different kinds of knowledge
 * have different identity semantics.
 */

import { createHash } from "node:crypto";
import type { MemoryKind } from "./types.js";

// ── Normalization ───────────────────────────────────────────────────────────

/** Normalize a string for canonical key comparison. */
export function normalize(value: string | undefined | null): string {
  if (!value) return "";
  return value.toLowerCase().trim().replace(/\s+/g, " ");
}

/** SHA-256 prefix hash (for content-based keys). Trim first, then truncate. */
export function hashPrefix(text: string, maxChars: number): string {
  const trimmed = text.trim().toLowerCase().substring(0, maxChars);
  return createHash("sha256").update(trimmed).digest("hex").substring(0, 16);
}

// ── Per-Kind Key Strategies ─────────────────────────────────────────────────

interface StructuredClaim {
  subject?: string;
  predicate?: string;
}

interface StructuredDecision {
  topic?: string;
}

interface StructuredProcedure {
  toolName?: string;
  key?: string;
}

interface StructuredInvariant {
  key?: string;
}

/**
 * Build a canonical key for a MemoryObject based on its kind.
 *
 * Returns undefined for kinds that don't support dedup/supersession
 * (chunks, messages, summaries, attempts, deltas, events).
 */
export function buildCanonicalKey(
  kind: MemoryKind,
  content: string,
  structured?: unknown,
): string | undefined {
  switch (kind) {
    case "claim": {
      // subject::predicate (normalized)
      const s = structured as StructuredClaim | undefined;
      const subject = normalize(s?.subject);
      const predicate = normalize(s?.predicate);
      if (!subject || !predicate) return undefined;
      return `claim::${subject}::${predicate}`;
    }

    case "decision": {
      // decision::topic (normalized, first 60 chars)
      const s = structured as StructuredDecision | undefined;
      const topic = normalize(s?.topic);
      if (!topic) return undefined;
      return `decision::${topic.substring(0, 60)}`;
    }

    case "entity": {
      // entity::name (lowercased, trimmed)
      const name = normalize(content);
      if (!name) return undefined;
      return `entity::${name}`;
    }

    case "loop": {
      // loop::hash(first 100 chars) — catches near-duplicate tasks
      if (!content || content.trim().length < 3) return undefined;
      return `loop::${hashPrefix(content, 100)}`;
    }

    case "procedure": {
      // proc::tool_name::pattern_key
      const s = structured as StructuredProcedure | undefined;
      const toolName = normalize(s?.toolName);
      const key = normalize(s?.key);
      if (!toolName || !key) return undefined;
      return `proc::${toolName}::${key}`;
    }

    case "invariant": {
      // inv::key
      const s = structured as StructuredInvariant | undefined;
      const key = normalize(s?.key);
      if (!key) return undefined;
      return `inv::${key}`;
    }

    case "conflict": {
      // conflict::hash(content) — conflicts are unique per subject matter
      if (!content || !content.trim()) return undefined;
      return `conflict::${hashPrefix(content, 200)}`;
    }

    // No dedup for these kinds — they are append-only or identity-less
    case "event":
    case "chunk":
    case "message":
    case "summary":
    case "attempt":
    case "delta":
      return undefined;

    default:
      return undefined;
  }
}
