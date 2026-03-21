import { readFile } from "fs/promises";
import type { ParsedDocument, StructureHint, DocMetadata } from "./index.js";

/**
 * Parse markdown files, extracting heading structure and code blocks.
 * Also handles YAML frontmatter for metadata.
 */
export async function parseMarkdown(filePath: string): Promise<ParsedDocument> {
  const raw = await readFile(filePath, "utf-8");
  const structure: StructureHint[] = [];
  let text = raw;
  const metadata: DocMetadata = { fileType: "markdown" };

  // Extract YAML frontmatter
  const fmMatch = raw.match(/^---\n([\s\S]*?)\n---\n/);
  if (fmMatch) {
    text = raw.slice(fmMatch[0].length);
    const fm = fmMatch[1];

    // Simple YAML key extraction (no dependency needed)
    const titleMatch = fm.match(/^title:\s*["']?(.+?)["']?\s*$/m);
    const authorMatch = fm.match(/^author:\s*["']?(.+?)["']?\s*$/m);
    const dateMatch = fm.match(/^date:\s*["']?(.+?)["']?\s*$/m);
    const tagsMatch = fm.match(/^tags:\s*\[(.+?)\]/m);

    if (titleMatch) metadata.title = titleMatch[1];
    if (authorMatch) metadata.author = authorMatch[1];
    if (dateMatch) metadata.date = dateMatch[1];
    if (tagsMatch)
      metadata.tags = tagsMatch[1].split(",").map((t) => t.trim().replace(/["']/g, ""));
  }

  // Find headings
  const headingRegex = /^(#{1,6})\s+(.+)$/gm;
  let match;
  while ((match = headingRegex.exec(text)) !== null) {
    structure.push({
      type: "heading",
      level: match[1].length,
      startOffset: match.index,
      endOffset: match.index + match[0].length,
    });
  }

  // Find code blocks
  const codeBlockRegex = /^```(\w*)\n[\s\S]*?^```$/gm;
  while ((match = codeBlockRegex.exec(text)) !== null) {
    structure.push({
      type: "code_block",
      language: match[1] || undefined,
      startOffset: match.index,
      endOffset: match.index + match[0].length,
    });
  }

  // Use first heading as title if not set from frontmatter
  if (!metadata.title) {
    const firstHeading = structure.find((s) => s.type === "heading");
    if (firstHeading) {
      const headingText = text.slice(firstHeading.startOffset, firstHeading.endOffset);
      metadata.title = headingText.replace(/^#+\s+/, "");
    }
  }

  // Set source
  metadata.source = filePath;

  return { text, structure, metadata };
}
