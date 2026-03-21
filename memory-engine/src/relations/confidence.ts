/**
 * Confidence decay for entity awareness.
 *
 * effective = base * min(1.0, mentions / 3) * recencyWeight(daysSince)
 *
 * Recency weights:
 *   < 7 days  → 1.0
 *   < 30 days → 0.8
 *   < 90 days → 0.5
 *   ≥ 90 days → 0.3
 */

function recencyWeight(daysSinceLastSeen: number): number {
  if (daysSinceLastSeen < 7) return 1.0;
  if (daysSinceLastSeen < 30) return 0.8;
  if (daysSinceLastSeen < 90) return 0.5;
  return 0.3;
}

/**
 * Compute effective confidence for an entity given its base confidence,
 * mention count, and recency.
 */
export function effectiveConfidence(
  base: number,
  mentionCount: number,
  daysSinceLastSeen: number,
): number {
  const mentionFactor = Math.min(1.0, mentionCount / 3);
  const recency = recencyWeight(daysSinceLastSeen);
  return base * mentionFactor * recency;
}
