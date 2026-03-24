import xxhash from "xxhash-wasm";

let initPromise: ReturnType<typeof xxhash> | null = null;

async function getHasher() {
  if (!initPromise) {
    initPromise = xxhash();
  }
  return initPromise;
}

/**
 * Hash text content. Returns xxhash64 as a zero-padded 16-char hex string.
 * Same format as contentHashBytes — both return zero-padded hex.
 */
export async function contentHash(text: string): Promise<string> {
  const { h64Raw } = await getHasher();
  return h64Raw(new TextEncoder().encode(text)).toString(16).padStart(16, "0");
}

/**
 * Hash binary content. Returns xxhash64 as a zero-padded 16-char hex string.
 */
export async function contentHashBytes(data: Uint8Array): Promise<string> {
  const { h64Raw } = await getHasher();
  return h64Raw(data).toString(16).padStart(16, "0");
}
