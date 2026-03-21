export interface FormattedChunk {
  text: string;
  contextPrefix?: string;
  source?: string;
  score?: number;
}

export function formatResultsAsMarkdown(
  query: string,
  chunks: FormattedChunk[],
  tokenBudget: number,
): string {
  if (chunks.length === 0) {
    return `No results found for: "${query}"`;
  }

  const lines: string[] = [];
  let estimatedTokens = 0;

  // Group by source
  const bySource = new Map<string, FormattedChunk[]>();
  for (const chunk of chunks) {
    const src = chunk.source ?? "Unknown";
    if (!bySource.has(src)) bySource.set(src, []);
    bySource.get(src)!.push(chunk);
  }

  for (const [source, sourceChunks] of bySource) {
    const header = `### ${source}`;
    lines.push(header);
    estimatedTokens += estimateTokens(header);

    for (const chunk of sourceChunks) {
      if (estimatedTokens >= tokenBudget) break;

      if (chunk.contextPrefix) {
        lines.push(`> ${chunk.contextPrefix}`);
        estimatedTokens += estimateTokens(chunk.contextPrefix);
      }

      lines.push(chunk.text);
      lines.push("");
      estimatedTokens += estimateTokens(chunk.text);
    }

    if (estimatedTokens >= tokenBudget) break;
  }

  return lines.join("\n");
}

/**
 * Estimate token count for a string.
 * Uses a character-based heuristic (4 chars ≈ 1 token) which is more accurate
 * than word-count methods across different content types (code, prose, URLs).
 * The word-count approach overestimates for code/URLs and underestimates for
 * languages with longer words. Character-based stays within ±15% for most models.
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  // ~4 chars per token is the industry standard heuristic for BPE tokenizers
  // (GPT, Claude, BGE, etc.). Add a small buffer for safety.
  return Math.ceil(text.length / 3.8);
}

/**
 * Common abbreviations that should NOT trigger sentence boundaries.
 */
const ABBREVIATIONS = new Set([
  "mr", "mrs", "ms", "dr", "prof", "sr", "jr", "st", "ave", "blvd",
  "vs", "etc", "inc", "ltd", "corp", "dept", "univ", "approx",
  "fig", "eq", "vol", "no", "pp", "ed", "rev", "gen", "gov",
  "sgt", "cpl", "pvt", "capt", "lt", "col", "cmdr", "adm",
  "i.e", "e.g", "cf", "al",  // "et al.", "e.g.", "i.e.", "cf."
]);

/**
 * Split text into sentences with robust handling of:
 * - Abbreviations (Dr., Mr., U.S., e.g., etc.)
 * - Decimal numbers (3.14, $1.50)
 * - URLs (http://example.com)
 * - Ellipsis (...)
 * - Multiple punctuation (!!, ?!)
 */
export function splitSentences(text: string): string[] {
  if (!text || !text.trim()) return [];

  const normalized = text.replace(/\n+/g, " ").replace(/\s+/g, " ").trim();

  const sentences: string[] = [];
  let current = "";

  for (let i = 0; i < normalized.length; i++) {
    const char = normalized[i];
    current += char;

    // Check for sentence-ending punctuation
    if (char === "." || char === "!" || char === "?") {
      // Consume trailing punctuation (e.g., "!!", "?!", "...")
      while (i + 1 < normalized.length && /[.!?]/.test(normalized[i + 1])) {
        current += normalized[++i];
      }

      // Must be followed by whitespace or end of string to be a sentence boundary
      const nextChar = normalized[i + 1];
      if (nextChar !== undefined && nextChar !== " ") {
        continue; // Not a boundary (e.g., "3.14", "U.S.A")
      }

      // Check if the period follows an abbreviation
      if (char === ".") {
        // Extract the word before the period
        const beforePeriod = current.slice(0, -1).trim();
        const lastWord = beforePeriod.split(/\s+/).pop()?.toLowerCase().replace(/[^\w.]/g, "") ?? "";

        // Skip if it's a known abbreviation
        if (ABBREVIATIONS.has(lastWord) || ABBREVIATIONS.has(lastWord.replace(/\./g, ""))) {
          continue;
        }

        // Skip dotted acronyms like "U.S.", "U.K.", "A.M.", "P.M."
        if (/^[a-z](\.[a-z])+$/i.test(lastWord)) {
          continue;
        }

        // Skip if it looks like a number (decimal, IP, version)
        if (/\d$/.test(beforePeriod)) {
          // Check if next char is a digit (e.g., "3.14")
          const afterSpace = normalized[i + 2];
          if (afterSpace && /\d/.test(afterSpace)) continue;
        }

        // Skip single capital letter (abbreviation like initial "J. Smith")
        if (lastWord.length === 1 && /[A-Z]/.test(beforePeriod.slice(-1))) {
          continue;
        }
      }

      // It's a sentence boundary
      const trimmed = current.trim();
      if (trimmed.length > 0) {
        sentences.push(trimmed);
      }
      current = "";
    }
  }

  // Flush remaining text
  const remaining = current.trim();
  if (remaining.length > 0) {
    sentences.push(remaining);
  }

  return sentences;
}
