/**
 * Rough token estimate: ~4 chars per token.
 *
 * Used throughout the memory engine for compaction thresholds, context
 * assembly budgets, and expansion limits. Serviceable for English prose;
 * structured content (JSON, code) will drift — but the heuristic is
 * intentionally conservative and matches VoltCode's Token.estimate.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
