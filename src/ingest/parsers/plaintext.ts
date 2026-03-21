import { readFile } from "fs/promises";
import { basename } from "path";
import type { ParsedDocument, DocMetadata } from "./index.js";

export async function parsePlaintext(filePath: string): Promise<ParsedDocument> {
  const text = await readFile(filePath, "utf-8");
  const metadata: DocMetadata = {
    fileType: "plaintext",
    title: basename(filePath),
    source: filePath,
  };

  return { text, structure: [], metadata };
}
