import { readFile } from "fs/promises";
import { basename } from "path";
import { parse } from "csv-parse/sync";
import type { ParsedDocument, StructureHint, DocMetadata } from "./index.js";

/**
 * Parse CSV files. Converts to a text representation with headers.
 * Structure hints mark row groups for table chunking.
 */
export async function parseCsv(filePath: string): Promise<ParsedDocument> {
  const raw = await readFile(filePath, "utf-8");

  const records = parse(raw, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    relax_column_count: true,
  }) as Record<string, string>[];

  if (records.length === 0) {
    return {
      text: "",
      structure: [],
      metadata: { fileType: "csv", title: basename(filePath), source: filePath },
    };
  }

  const headers = Object.keys(records[0]);
  const headerLine = headers.join(" | ");
  const lines: string[] = [headerLine, "-".repeat(headerLine.length)];

  for (const record of records) {
    lines.push(headers.map((h) => record[h] ?? "").join(" | "));
  }

  const text = lines.join("\n");

  // Mark table regions for chunking (groups of ~20 rows)
  const structure: StructureHint[] = [{
    type: "table",
    startOffset: 0,
    endOffset: text.length,
  }];

  const metadata: DocMetadata = {
    fileType: "csv",
    title: basename(filePath),
    source: filePath,
  };

  return { text, structure, metadata };
}
