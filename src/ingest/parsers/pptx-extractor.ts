import { readFile } from "fs/promises";

/**
 * Lightweight PPTX text extractor.
 * PPTX files are ZIP archives containing XML slide files.
 * Uses Node.js built-in zlib for decompression.
 *
 * Extracts text from:
 * - ppt/slides/slide1.xml, slide2.xml, etc.
 * - Pulls text from <a:t> tags (PowerPoint text elements)
 * - Preserves slide order
 */

interface ZipEntry {
  filename: string;
  data: Buffer;
}

/**
 * Parse a PPTX buffer and return an array of slide text strings.
 */
export async function parseBuffer(buffer: Buffer): Promise<string[]> {
  const entries = await extractZipEntries(buffer);

  // Find slide XML files and sort by slide number
  const slideEntries = entries
    .filter((e) => /^ppt\/slides\/slide\d+\.xml$/i.test(e.filename))
    .sort((a, b) => {
      const numA = parseInt(a.filename.match(/slide(\d+)/i)?.[1] ?? "0", 10);
      const numB = parseInt(b.filename.match(/slide(\d+)/i)?.[1] ?? "0", 10);
      return numA - numB;
    });

  const slides: string[] = [];

  for (const entry of slideEntries) {
    const xml = entry.data.toString("utf-8");
    const text = extractTextFromXml(xml);
    slides.push(text);
  }

  return slides;
}

/**
 * Extract text content from PowerPoint XML.
 * Looks for <a:t> tags which contain the actual text.
 * Groups text by <a:p> (paragraph) tags.
 */
function extractTextFromXml(xml: string): string {
  const lines: string[] = [];

  // Split by paragraph tags
  const paragraphs = xml.split(/<a:p[\s>]/);

  for (const para of paragraphs) {
    // Extract all text elements within this paragraph
    const textMatches = para.match(/<a:t[^>]*>([^<]*)<\/a:t>/g);
    if (textMatches) {
      const lineText = textMatches
        .map((m) => {
          const match = m.match(/<a:t[^>]*>([^<]*)<\/a:t>/);
          return match ? match[1] : "";
        })
        .join("")
        .trim();

      if (lineText) {
        lines.push(lineText);
      }
    }
  }

  return lines.join("\n");
}

/**
 * Minimal ZIP file parser.
 * Reads local file headers and extracts entries.
 * Supports Store (no compression) and Deflate methods.
 */
async function extractZipEntries(buffer: Buffer): Promise<ZipEntry[]> {
  const { inflateRawSync } = await import("zlib");
  const entries: ZipEntry[] = [];
  let offset = 0;

  while (offset < buffer.length - 4) {
    // Look for local file header signature: PK\x03\x04
    if (
      buffer[offset] !== 0x50 ||
      buffer[offset + 1] !== 0x4b ||
      buffer[offset + 2] !== 0x03 ||
      buffer[offset + 3] !== 0x04
    ) {
      break; // No more local file headers
    }

    const generalPurposeFlags = buffer.readUInt16LE(offset + 6);
    const compressionMethod = buffer.readUInt16LE(offset + 8);
    let compressedSize = buffer.readUInt32LE(offset + 18);
    const filenameLength = buffer.readUInt16LE(offset + 26);
    const extraLength = buffer.readUInt16LE(offset + 28);
    const hasDataDescriptor = (generalPurposeFlags & 0x08) !== 0;

    const filenameStart = offset + 30;
    const filename = buffer
      .subarray(filenameStart, filenameStart + filenameLength)
      .toString("utf-8");

    const dataStart = filenameStart + filenameLength + extraLength;

    // If bit 3 is set, sizes in the local header may be zero;
    // the real sizes follow the compressed data in a data descriptor.
    if (hasDataDescriptor && compressedSize === 0) {
      // Scan for the data descriptor signature (PK\x07\x08) or next local header.
      // Data descriptor: [optional sig 0x08074b50] crc32(4) compSize(4) uncompSize(4)
      let scanPos = dataStart;
      while (scanPos < buffer.length - 4) {
        if (
          buffer[scanPos] === 0x50 && buffer[scanPos + 1] === 0x4b &&
          ((buffer[scanPos + 2] === 0x07 && buffer[scanPos + 3] === 0x08) ||
           (buffer[scanPos + 2] === 0x03 && buffer[scanPos + 3] === 0x04))
        ) {
          break;
        }
        scanPos++;
      }
      compressedSize = scanPos - dataStart;
    }

    const compressedData = buffer.subarray(dataStart, dataStart + compressedSize);

    let data: Buffer;
    if (compressionMethod === 0) {
      // Stored (no compression)
      data = Buffer.from(compressedData);
    } else if (compressionMethod === 8) {
      // Deflate
      try {
        data = inflateRawSync(compressedData);
      } catch {
        data = Buffer.alloc(0);
      }
    } else {
      data = Buffer.alloc(0);
    }

    if (filename && !filename.endsWith("/")) {
      entries.push({ filename, data });
    }

    let nextOffset = dataStart + compressedSize;
    // Skip past data descriptor if present
    if (hasDataDescriptor) {
      if (nextOffset + 4 <= buffer.length &&
          buffer[nextOffset] === 0x50 && buffer[nextOffset + 1] === 0x4b &&
          buffer[nextOffset + 2] === 0x07 && buffer[nextOffset + 3] === 0x08) {
        nextOffset += 16; // sig(4) + crc32(4) + compSize(4) + uncompSize(4)
      } else {
        nextOffset += 12; // crc32(4) + compSize(4) + uncompSize(4) (no sig)
      }
    }
    offset = nextOffset;
  }

  return entries;
}
