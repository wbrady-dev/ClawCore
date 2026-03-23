import { readFile } from "fs/promises";
import { basename } from "path";
import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";
import type { ParsedDocument, StructureHint, DocMetadata } from "./index.js";

/**
 * Parse HTML files using Mozilla Readability for content extraction.
 * Falls back to full body text if Readability can't extract an article.
 */
export async function parseHtml(filePath: string): Promise<ParsedDocument> {
  const raw = await readFile(filePath, "utf-8");
  const dom = new JSDOM(raw, { url: `file://${filePath}` });
  const doc = dom.window.document;

  const metadata: DocMetadata = {
    fileType: "html",
    source: filePath,
  };

  // Extract metadata from HTML head
  const titleEl = doc.querySelector("title");
  if (titleEl?.textContent) metadata.title = titleEl.textContent.trim();

  const metaAuthor = doc.querySelector('meta[name="author"]');
  if (metaAuthor) metadata.author = metaAuthor.getAttribute("content") ?? undefined;

  const metaDate = doc.querySelector('meta[name="date"]') ??
    doc.querySelector('meta[property="article:published_time"]');
  if (metaDate) metadata.date = metaDate.getAttribute("content") ?? undefined;

  // Try Readability extraction
  const reader = new Readability(doc);
  const article = reader.parse();

  let text: string;
  if (article?.textContent) {
    text = article.textContent.trim();
    if (article.title && !metadata.title) metadata.title = article.title;
  } else {
    // Fallback: extract body text
    text = doc.body?.textContent?.trim() ?? "";
  }

  if (!metadata.title) {
    metadata.title = basename(filePath, ".html");
  }

  // Find headings in the original HTML for structure hints
  const structure: StructureHint[] = [];
  const headings = doc.querySelectorAll("h1, h2, h3, h4, h5, h6");
  let searchFrom = 0;
  for (const heading of headings) {
    const headingText = heading.textContent?.trim() ?? "";
    const level = parseInt(heading.tagName.charAt(1), 10);
    const idx = text.indexOf(headingText, searchFrom);
    if (idx >= 0) {
      structure.push({
        type: "heading",
        level,
        startOffset: idx,
        endOffset: idx + headingText.length,
      });
      searchFrom = idx + headingText.length;
    }
  }

  return { text, structure, metadata };
}
