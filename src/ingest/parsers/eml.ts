import { readFile } from "fs/promises";
import type { ParsedDocument, DocMetadata } from "./index.js";

/**
 * Parse .eml email files using mailparser.
 */
export async function parseEml(filePath: string): Promise<ParsedDocument> {
  const raw = await readFile(filePath, "utf-8");
  const { simpleParser } = await import("mailparser");
  const parsed = await simpleParser(raw);

  const metadata: DocMetadata = {
    fileType: "email",
    source: filePath,
    title: parsed.subject ?? "Untitled Email",
    date: parsed.date?.toISOString(),
  };

  if (parsed.from?.text) {
    metadata.author = parsed.from.text;
  }

  // Build text from email parts
  const parts: string[] = [];

  parts.push(`Subject: ${parsed.subject ?? "(no subject)"}`);
  parts.push(`From: ${parsed.from?.text ?? "unknown"}`);
  const toText = Array.isArray(parsed.to) ? parsed.to.map((t: { text: string }) => t.text).join(", ") : parsed.to?.text ?? "unknown";
  parts.push(`To: ${toText}`);
  if (parsed.date) parts.push(`Date: ${parsed.date.toISOString()}`);
  parts.push("");

  // Prefer plain text body, fall back to HTML-stripped text
  if (parsed.text) {
    parts.push(parsed.text);
  } else if (parsed.textAsHtml) {
    // Strip HTML tags for a rough text extraction
    parts.push(parsed.textAsHtml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
  }

  // Note attachments in metadata
  if (parsed.attachments && parsed.attachments.length > 0) {
    const attachNames = parsed.attachments.map((a: { filename?: string }) => a.filename ?? "unnamed").join(", ");
    parts.push(`\nAttachments: ${attachNames}`);
    metadata.tags = ["has-attachments"];
  }

  return { text: parts.join("\n"), structure: [], metadata };
}
