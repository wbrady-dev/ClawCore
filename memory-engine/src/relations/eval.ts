/**
 * Awareness eval harness — in-memory ring buffer for tracking
 * awareness note quality, latency, and fire rate.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AwarenessEvent {
  timestamp: number;
  fired: boolean;
  noteCount: number;
  noteTypes: string[];
  latencyMs: number;
  terms: string[];
  tokensAdded: number;
}

export interface AwarenessStats {
  totalTurns: number;
  firedCount: number;
  fireRate: number;
  latencyP50: number;
  latencyP95: number;
  avgTokensWhenFired: number;
  noteTypeBreakdown: Record<string, number>;
}

// ---------------------------------------------------------------------------
// Ring buffer
// ---------------------------------------------------------------------------

const MAX_EVENTS = 2000;
const events: AwarenessEvent[] = [];

/**
 * Record an awareness event (called from buildAwarenessNote on every invocation).
 */
export function recordAwarenessEvent(event: Omit<AwarenessEvent, "timestamp">): void {
  events.push({ ...event, timestamp: Date.now() });
  if (events.length > MAX_EVENTS) {
    events.splice(0, events.length - MAX_EVENTS);
  }
}

/**
 * Get awareness statistics for a time window.
 *
 * @param windowMs - Time window in milliseconds (default: 24 hours).
 */
export function getAwarenessStats(windowMs = 86_400_000): AwarenessStats {
  const cutoff = Date.now() - windowMs;
  const recent = events.filter((e) => e.timestamp > cutoff);

  if (recent.length === 0) {
    return {
      totalTurns: 0,
      firedCount: 0,
      fireRate: 0,
      latencyP50: 0,
      latencyP95: 0,
      avgTokensWhenFired: 0,
      noteTypeBreakdown: {},
    };
  }

  const fired = recent.filter((e) => e.fired);
  const latencies = recent.map((e) => e.latencyMs).sort((a, b) => a - b);

  const noteTypeBreakdown: Record<string, number> = {};
  for (const e of fired) {
    for (const t of e.noteTypes) {
      noteTypeBreakdown[t] = (noteTypeBreakdown[t] ?? 0) + 1;
    }
  }

  return {
    totalTurns: recent.length,
    firedCount: fired.length,
    fireRate: Math.round((fired.length / recent.length) * 100),
    latencyP50: latencies[Math.floor(latencies.length * 0.5)] ?? 0,
    latencyP95: latencies[Math.floor(latencies.length * 0.95)] ?? 0,
    avgTokensWhenFired:
      fired.length > 0
        ? Math.round(fired.reduce((s, e) => s + e.tokensAdded, 0) / fired.length)
        : 0,
    noteTypeBreakdown,
  };
}

/**
 * Clear all events (for tests).
 */
export function resetAwarenessEventsForTests(): void {
  events.length = 0;
}
