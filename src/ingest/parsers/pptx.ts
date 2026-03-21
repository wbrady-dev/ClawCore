import { readFile } from "fs/promises";
import { basename } from "path";
import { createReadStream } from "fs";
import { Readable } from "stream";
import type { ParsedDocument, StructureHint, DocMetadata } from "./index.js";

// PPTX files are ZIP archives containing XML slides
// We parse them without heavy dependencies using JSZip-style extraction

/**
 * Parse .pptx files by extracting slide XML content.
 * Each slide becomes a section with its slide number as context.
 */
export async function parsePptx(filePath: string): Promise<ParsedDocument> {
  const buffer = await readFile(filePath);

  // PPTX is a ZIP file — use Node's built-in zlib via a lightweight approach
  const { parseBuffer } = await import("./pptx-extractor.js");
  const slides = await parseBuffer(buffer);

  const metadata: DocMetadata = {
    fileType: "pptx",
    title: basename(filePath, ".pptx"),
    source: filePath,
  };

  const structure: StructureHint[] = [];
  const parts: string[] = [];
  let offset = 0;

  for (let i = 0; i < slides.length; i++) {
    const slideHeader = `## Slide ${i + 1}`;
    const slideContent = slides[i].trim();

    if (!slideContent) continue;

    // Use first slide's first line as title if it looks like one
    if (i === 0 && slideContent.length < 200) {
      const firstLine = slideContent.split("\n")[0].trim();
      if (firstLine) metadata.title = firstLine;
    }

    structure.push({
      type: "heading",
      level: 2,
      startOffset: offset,
      endOffset: offset + slideHeader.length,
    });

    const section = `${slideHeader}\n${slideContent}`;
    parts.push(section);
    offset += section.length + 2; // +2 for \n\n separator
  }

  return {
    text: parts.join("\n\n"),
    structure,
    metadata,
  };
}
