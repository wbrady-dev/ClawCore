import { estimateTokens } from "../../../utils/format.js";
import type { StructureHint } from "../../parsers/index.js";
import type { Chunk } from "../semantic.js";

/**
 * Markdown chunking strategy: split on heading boundaries.
 * Each section (heading + content until next same-or-higher heading) is a chunk.
 */
export function chunkMarkdown(
  text: string,
  structure: StructureHint[],
  maxTokens: number,
): Chunk[] {
  const headings = structure
    .filter((s) => s.type === "heading")
    .sort((a, b) => a.startOffset - b.startOffset);

  if (headings.length === 0) {
    // No headings — fall through to paragraph-based splitting
    const tokens = estimateTokens(text);
    if (tokens <= maxTokens) {
      return [{ text, position: 0, tokenCount: tokens }];
    }
    // Split oversized headingless content by paragraphs
    const paragraphs = text.split(/\n\s*\n/);
    const fallbackChunks: Chunk[] = [];
    let buf: string[] = [];
    let bufTokens = 0;
    for (const para of paragraphs) {
      const pt = estimateTokens(para);
      if (bufTokens + pt > maxTokens && buf.length > 0) {
        fallbackChunks.push({ text: buf.join("\n\n"), position: fallbackChunks.length, tokenCount: bufTokens });
        buf = [];
        bufTokens = 0;
      }
      buf.push(para);
      bufTokens += pt;
    }
    if (buf.length > 0) {
      fallbackChunks.push({ text: buf.join("\n\n"), position: fallbackChunks.length, tokenCount: bufTokens });
    }
    return fallbackChunks;
  }

  const sections: { text: string; prefix: string }[] = [];

  // Content before first heading
  const preContent = text.slice(0, headings[0].startOffset).trim();
  if (preContent) {
    sections.push({ text: preContent, prefix: "" });
  }

  // Build heading chain for context prefixes
  const headingStack: string[] = [];
  const headingLevels: number[] = [];

  for (let i = 0; i < headings.length; i++) {
    const h = headings[i];
    const nextOffset =
      i + 1 < headings.length ? headings[i + 1].startOffset : text.length;

    const sectionText = text.slice(h.startOffset, nextOffset).trim();
    const headingText = text
      .slice(h.startOffset, h.endOffset)
      .replace(/^#+\s+/, "");
    const level = h.level ?? 1;

    // Update heading stack
    while (
      headingLevels.length > 0 &&
      headingLevels[headingLevels.length - 1] >= level
    ) {
      headingStack.pop();
      headingLevels.pop();
    }
    headingStack.push(headingText);
    headingLevels.push(level);

    const prefix = headingStack.join(" > ");
    sections.push({ text: sectionText, prefix });
  }

  // Convert to chunks, splitting oversized sections
  const chunks: Chunk[] = [];

  for (const section of sections) {
    const tokens = estimateTokens(section.text);

    if (tokens <= maxTokens) {
      chunks.push({
        text: section.text,
        contextPrefix: section.prefix || undefined,
        position: chunks.length,
        tokenCount: tokens,
      });
    } else {
      // Split oversized section by paragraphs
      const paragraphs = section.text.split(/\n\s*\n/);
      let buf: string[] = [];
      let bufTokens = 0;

      for (const para of paragraphs) {
        const pt = estimateTokens(para);
        if (bufTokens + pt > maxTokens && buf.length > 0) {
          chunks.push({
            text: buf.join("\n\n"),
            contextPrefix: section.prefix || undefined,
            position: chunks.length,
            tokenCount: bufTokens,
          });
          buf = [];
          bufTokens = 0;
        }
        buf.push(para);
        bufTokens += pt;
      }

      if (buf.length > 0) {
        chunks.push({
          text: buf.join("\n\n"),
          contextPrefix: section.prefix || undefined,
          position: chunks.length,
          tokenCount: bufTokens,
        });
      }
    }
  }

  return chunks;
}
