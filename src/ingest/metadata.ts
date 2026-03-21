import { stat } from "fs/promises";
import type { DocMetadata } from "./parsers/index.js";

export interface FullMetadata extends DocMetadata {
  sizeBytes?: number;
  modifiedAt?: string;
}

/**
 * Enrich parsed metadata with filesystem stats and user-provided tags.
 */
export async function enrichMetadata(
  parsedMeta: DocMetadata,
  filePath: string,
  userTags?: string[],
): Promise<FullMetadata> {
  const meta: FullMetadata = { ...parsedMeta };

  try {
    const stats = await stat(filePath);
    meta.sizeBytes = stats.size;
    meta.modifiedAt = stats.mtime.toISOString();
  } catch {
    // Ignore stat errors (e.g., raw text ingestion)
  }

  if (userTags && userTags.length > 0) {
    meta.tags = [...(meta.tags ?? []), ...userTags];
  }

  return meta;
}
