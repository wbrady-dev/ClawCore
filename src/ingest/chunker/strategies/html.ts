import { chunkMarkdown } from "./markdown.js";
import type { StructureHint } from "../../parsers/index.js";
import type { Chunk } from "../semantic.js";

/**
 * HTML chunking strategy: reuses markdown heading-based strategy
 * since the HTML parser already extracts headings as structure hints.
 */
export function chunkHtml(
  text: string,
  structure: StructureHint[],
  maxTokens: number,
): Chunk[] {
  return chunkMarkdown(text, structure, maxTokens);
}
