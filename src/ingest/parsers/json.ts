import { readFile } from "fs/promises";
import { basename } from "path";
import type { ParsedDocument, DocMetadata } from "./index.js";

/**
 * Parse JSON/JSONL files. Flattens structure into readable text.
 */
export async function parseJson(filePath: string): Promise<ParsedDocument> {
  const raw = await readFile(filePath, "utf-8");
  const metadata: DocMetadata = {
    fileType: "json",
    title: basename(filePath),
    source: filePath,
  };

  let text: string;

  if (filePath.endsWith(".jsonl")) {
    // JSONL: each line is a JSON object
    const lines = raw.split("\n").filter((l) => l.trim());
    const parts: string[] = [];
    for (const line of lines) {
      try {
        const obj = JSON.parse(line);
        parts.push(flattenObject(obj));
      } catch {
        parts.push(line);
      }
    }
    text = parts.join("\n\n");
  } else {
    // Regular JSON
    try {
      const obj = JSON.parse(raw);
      if (Array.isArray(obj)) {
        text = obj.map((item) => flattenObject(item)).join("\n\n");
      } else {
        text = flattenObject(obj);
      }
    } catch {
      text = raw;
    }
  }

  return { text, structure: [], metadata };
}

function flattenObject(obj: unknown, prefix = ""): string {
  if (obj === null || obj === undefined) return "";
  if (typeof obj !== "object") return `${prefix}${obj}`;

  const lines: string[] = [];
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      lines.push(flattenObject(value, path));
    } else if (Array.isArray(value)) {
      if (value.length > 0 && typeof value[0] === "object" && value[0] !== null) {
        value.forEach((item, i) => lines.push(flattenObject(item, `${path}[${i}]`)));
      } else {
        lines.push(`${path}: ${value.join(", ")}`);
      }
    } else {
      lines.push(`${path}: ${value}`);
    }
  }
  return lines.join("\n");
}
