/**
 * Correction & Uncertainty Signal Detection — RSMA.
 *
 * Detects natural language signals that indicate a state change:
 * - Corrections: "actually", "not anymore", "scratch that" → supersession
 * - Uncertainty: "I think", "maybe", "for now" → provisional flag
 * - Preferences: "I prefer", "don't suggest" → high-influence claims
 * - Temporal: "next Monday", "by Friday" → effective_at / expires_at
 *
 * All detection is regex-based (free, <1ms). No LLM calls.
 */

// ── Correction Signals ──────────────────────────────────────────────────────

const CORRECTION_PATTERNS: RegExp[] = [
  /\bactually[,:]?\s+/i,
  /\bnot\s+(?:\w+\s){0,3}(?:anymore|any\smore)\b/i,
  /\bignore\s+(?:that|the|my|what)\b/i,
  /\b(?:i|we)\s+changed\s+(?:my|our)\s+mind\b/i,
  /\bscratch\s+that\b/i,
  /\b(?:instead|rather)\s*[,:]\s*/i,
  /\bforget\s+(?:about|what\s+(?:i|we)\s+said)\b/i,
  /\b(?:no|nope)[,:]?\s+(?:not\s+)?(?:that|this)\b/i,
  /\b(?:that|this)\s+(?:is|was)\s+wrong\b/i,
  /\b(?:we|i)\s+(?:should|need\s+to)\s+(?:switch|change|move|migrate)\b/i,
];

/**
 * Detect if text contains a correction signal.
 * Returns the matched pattern text if found, or null.
 */
export function detectCorrection(text: string): string | null {
  for (const pattern of CORRECTION_PATTERNS) {
    const match = pattern.exec(text);
    if (match) return match[0].trim();
  }
  return null;
}

// ── Uncertainty Signals ─────────────────────────────────────────────────────

const UNCERTAINTY_PATTERNS: RegExp[] = [
  /\b(?:i\sthink|probably|maybe|might|not\ssure|possibly|tentatively)\b/i,
  /\bfor\s+now\b/i,
  /\b(?:let's|let\s+us)\s+(?:try|see)\b/i,
  /\b(?:could|might)\s+(?:be|work)\b/i,
];

/**
 * Detect if text contains an uncertainty signal.
 * Returns the matched pattern text if found, or null.
 */
export function detectUncertainty(text: string): string | null {
  for (const pattern of UNCERTAINTY_PATTERNS) {
    const match = pattern.exec(text);
    if (match) return match[0].trim();
  }
  return null;
}

// ── Preference Signals ──────────────────────────────────────────────────────

const PREFERENCE_PATTERNS: RegExp[] = [
  /\b(?:i|we)\s+prefer\b/i,
  /\b(?:i|we)\s+(?:like|love|enjoy)\s+(?:to\s+)?/i,
  /\b(?:i|we)\s+(?:don't|do\s+not)\s+(?:want|like|need)\b/i,
  /\bplease\s+(?:don't|do\s+not|never)\b/i,
  /\b(?:always|never)\s+(?:use|do|show|suggest|include|send)\b/i,
];

/**
 * Detect if text contains a preference signal.
 * Returns the matched pattern text if found, or null.
 */
export function detectPreference(text: string): string | null {
  for (const pattern of PREFERENCE_PATTERNS) {
    const match = pattern.exec(text);
    if (match) return match[0].trim();
  }
  return null;
}

// ── Temporal Signals ────────────────────────────────────────────────────────

/** Match temporal expressions and extract approximate date meaning. */
const TEMPORAL_PATTERNS: Array<{ pattern: RegExp; type: "effective" | "expiry" }> = [
  { pattern: /\bstarting\s+(?:next\s+)?(\w+)\b/i, type: "effective" },
  { pattern: /\bbeginning\s+(?:next\s+)?(\w+)\b/i, type: "effective" },
  { pattern: /\bfrom\s+(?:next\s+)?(\w+)\b/i, type: "effective" },
  { pattern: /\bby\s+(?:next\s+)?(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|tonight|eod|eow|end\s+of\s+\w{1,10})\b/i, type: "expiry" },
  { pattern: /\buntil\s+(\w+)\b/i, type: "expiry" },
  { pattern: /\bbefore\s+(\w+)\b/i, type: "expiry" },
  { pattern: /\bfor\s+the\s+next\s+(\d+)\s+(\w{1,20})\b/i, type: "expiry" },
];

export interface TemporalSignal {
  type: "effective" | "expiry";
  matchedText: string;
}

/**
 * Detect temporal signals in text.
 * Returns the first matched temporal expression, or null.
 */
export function detectTemporal(text: string): TemporalSignal | null {
  for (const { pattern, type } of TEMPORAL_PATTERNS) {
    const match = pattern.exec(text);
    if (match) {
      return { type, matchedText: match[0].trim() };
    }
  }
  return null;
}

// ── Combined Detection ──────────────────────────────────────────────────────

export interface SignalDetectionResult {
  isCorrection: boolean;
  correctionSignal: string | null;
  isUncertain: boolean;
  uncertaintySignal: string | null;
  isPreference: boolean;
  preferenceSignal: string | null;
  temporal: TemporalSignal | null;
}

/**
 * Run all signal detectors on a text.
 * All detections are independent — a single text can be both a correction and uncertain.
 */
export function detectSignals(text: string): SignalDetectionResult {
  const correctionSignal = detectCorrection(text);
  const uncertaintySignal = detectUncertainty(text);
  const preferenceSignal = detectPreference(text);
  const temporal = detectTemporal(text);

  return {
    isCorrection: correctionSignal !== null,
    correctionSignal,
    isUncertain: uncertaintySignal !== null,
    uncertaintySignal,
    isPreference: preferenceSignal !== null,
    preferenceSignal,
    temporal,
  };
}
