import { readFile } from "fs/promises";
import { basename } from "path";
import mammoth from "mammoth";
import type { ParsedDocument, StructureHint, DocMetadata } from "./index.js";

/**
 * Parse .docx files using mammoth.
 * Converts to markdown-like text preserving headings, lists, and tables.
 * Mammoth produces clean semantic output — ideal for RAG chunking.
 */
export async function parseDocx(filePath: string): Promise<ParsedDocument> {
  const buffer = await readFile(filePath);

  // Convert to markdown for best structure preservation
  const result = await mammoth.convertToMarkdown({ buffer });
  const text = result.value;

  const metadata: DocMetadata = {
    fileType: "docx",
    title: basename(filePath, ".docx"),
    source: filePath,
  };

  // Extract headings from the markdown output
  const structure: StructureHint[] = [];
  const headingRegex = /^(#{1,6})\s+(.+)$/gm;
  let match;
  while ((match = headingRegex.exec(text)) !== null) {
    structure.push({
      type: "heading",
      level: match[1].length,
      startOffset: match.index,
      endOffset: match.index + match[0].length,
    });

    // Use first heading as title
    if (!metadata.title || metadata.title === basename(filePath, ".docx")) {
      if (match[1].length === 1) {
        metadata.title = match[2].trim();
      }
    }
  }

  // Log warnings if any conversion issues
  if (result.messages.length > 0) {
    const warnings = result.messages
      .filter((m: { type: string; message: string }) => m.type === "warning")
      .map((m: { type: string; message: string }) => m.message);
    if (warnings.length > 0) {
      metadata.tags = ["conversion-warnings"];
    }
  }

  return { text, structure, metadata };
}
