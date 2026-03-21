import xxhash from "xxhash-wasm";

let initPromise: ReturnType<typeof xxhash> | null = null;

async function getHasher() {
  if (!initPromise) {
    initPromise = xxhash();
  }
  return initPromise;
}

export async function contentHash(text: string): Promise<string> {
  const { h64ToString } = await getHasher();
  return h64ToString(text);
}

export async function contentHashBytes(data: Uint8Array): Promise<string> {
  const { h64Raw } = await getHasher();
  return h64Raw(data).toString(16).padStart(16, "0");
}
