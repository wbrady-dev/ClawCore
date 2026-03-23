import xxhash from "xxhash-wasm";

let initPromise: ReturnType<typeof xxhash> | null = null;

async function getHasher() {
  if (!initPromise) {
    initPromise = xxhash();
  }
  return initPromise;
}

/**
 * Hash text content. Returns xxhash64 as a base-36 string (h64ToString format).
 *
 * NOTE(BUG 16): contentHash (text) and contentHashBytes (binary) produce
 * different string formats — base-36 vs zero-padded hex. Both are stable
 * and unique within their own domain, but they must NOT be compared to
 * each other. Text files always go through contentHash; binary files
 * (pdf, docx, pptx) always go through contentHashBytes.
 */
export async function contentHash(text: string): Promise<string> {
  const { h64ToString } = await getHasher();
  return h64ToString(text);
}

/**
 * Hash binary content. Returns xxhash64 as a zero-padded 16-char hex string.
 * See NOTE(BUG 16) on contentHash for format difference.
 */
export async function contentHashBytes(data: Uint8Array): Promise<string> {
  const { h64Raw } = await getHasher();
  return h64Raw(data).toString(16).padStart(16, "0");
}
