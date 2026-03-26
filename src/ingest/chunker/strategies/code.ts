import { estimateTokens } from "../../../utils/format.js";
import type { StructureHint } from "../../parsers/index.js";
import type { Chunk } from "../semantic.js";

/**
 * Code chunking strategy: split on function/class boundaries.
 * Import blocks are grouped into one chunk.
 * Each function/method becomes its own chunk.
 */
export function chunkCode(
  text: string,
  structure: StructureHint[],
  maxTokens: number,
): Chunk[] {
  const definitions = structure
    .filter((s) => s.type === "heading")
    .sort((a, b) => a.startOffset - b.startOffset);

  if (definitions.length === 0) {
    // No definitions found — fall back to line-based splitting
    return chunkByLines(text, maxTokens);
  }

  const chunks: Chunk[] = [];

  // Content before first definition (imports, module-level code)
  const preContent = text.slice(0, definitions[0].startOffset).trim();
  if (preContent && estimateTokens(preContent) > 20) {
    chunks.push({
      text: preContent,
      contextPrefix: "imports / module setup",
      position: chunks.length,
      tokenCount: estimateTokens(preContent),
    });
  }

  // Each definition becomes a chunk
  for (let i = 0; i < definitions.length; i++) {
    const def = definitions[i];
    const nextOffset =
      i + 1 < definitions.length ? definitions[i + 1].startOffset : text.length;

    const sectionText = text.slice(def.startOffset, nextOffset).trim();
    if (!sectionText) continue;

    const tokens = estimateTokens(sectionText);

    if (tokens <= maxTokens) {
      const defLine = text.slice(def.startOffset, def.endOffset).trim();
      chunks.push({
        text: sectionText,
        contextPrefix: defLine,
        position: chunks.length,
        tokenCount: tokens,
      });
    } else {
      // Split oversized function by logical breaks (blank lines)
      const parts = sectionText.split(/\n\s*\n/);
      let buf: string[] = [];
      let bufTokens = 0;
      const defLine = text.slice(def.startOffset, def.endOffset).trim();

      for (const part of parts) {
        const pt = estimateTokens(part);
        if (bufTokens + pt > maxTokens && buf.length > 0) {
          chunks.push({
            text: buf.join("\n\n"),
            contextPrefix: defLine,
            position: chunks.length,
            tokenCount: bufTokens,
          });
          buf = [];
          bufTokens = 0;
        }
        buf.push(part);
        bufTokens += pt;
      }
      if (buf.length > 0) {
        chunks.push({
          text: buf.join("\n\n"),
          contextPrefix: defLine,
          position: chunks.length,
          tokenCount: bufTokens,
        });
      }
    }
  }

  return chunks;
}

function chunkByLines(text: string, maxTokens: number): Chunk[] {
  const lines = text.split("\n");
  const chunks: Chunk[] = [];
  let buf: string[] = [];
  let bufTokens = 0;

  for (const line of lines) {
    const lt = estimateTokens(line);
    // Hard split if a single line exceeds maxTokens (e.g., minified JS, base64)
    if (lt > maxTokens && buf.length === 0) {
      for (let ci = 0; ci < line.length; ci += maxTokens * 4) {
        const slice = line.slice(ci, ci + maxTokens * 4);
        chunks.push({
          text: slice,
          position: chunks.length,
          tokenCount: estimateTokens(slice),
        });
      }
      continue;
    }
    if (bufTokens + lt > maxTokens && buf.length > 0) {
      chunks.push({
        text: buf.join("\n"),
        position: chunks.length,
        tokenCount: bufTokens,
      });
      buf = [];
      bufTokens = 0;
    }
    buf.push(line);
    bufTokens += lt;
  }

  if (buf.length > 0) {
    chunks.push({
      text: buf.join("\n"),
      position: chunks.length,
      tokenCount: bufTokens,
    });
  }

  return chunks;
}
