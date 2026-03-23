import { config } from "../config.js";
import { logger } from "../utils/logger.js";

export interface RerankResult {
  index: number;
  score: number;
  text: string;
}

/**
 * Rerank candidate documents using the cross-encoder on the model server.
 * Gracefully degrades: returns original order if reranker is unavailable.
 */
export async function rerank(
  query: string,
  documents: string[],
  topK?: number,
): Promise<RerankResult[]> {
  const url = `${config.reranker.url}/rerank`;

  try {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    const apiKey = process.env.RERANKER_API_KEY;
    if (apiKey) {
      headers["Authorization"] = `Bearer ${apiKey}`;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000); // 30s timeout

    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        query,
        documents,
        top_k: topK ?? documents.length,
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!response.ok) {
      logger.warn(
        { status: response.status },
        "Reranker returned error, falling back to original order",
      );
      return fallbackOrder(documents);
    }

    const data = (await response.json()) as { results: RerankResult[] };
    if (!data?.results || !Array.isArray(data.results)) {
      logger.warn("Reranker returned malformed response, falling back to original order");
      return fallbackOrder(documents);
    }
    logger.debug(
      { candidates: documents.length, returned: data.results.length },
      "Reranking complete",
    );
    return data.results;
  } catch (err) {
    logger.warn(
      { error: String(err) },
      "Reranker unavailable, falling back to original order",
    );
    return fallbackOrder(documents);
  }
}

function fallbackOrder(documents: string[]): RerankResult[] {
  return documents.map((text, index) => ({
    index,
    score: 1 - index / documents.length,
    text,
  }));
}
