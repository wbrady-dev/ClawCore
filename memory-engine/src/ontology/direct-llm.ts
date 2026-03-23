/**
 * Direct LLM Client — calls provider APIs with API keys.
 *
 * Used when extraction has its own API key configured, bypassing
 * OpenClaw's OAuth. Keeps extraction tokens completely isolated
 * from agent conversation tokens.
 *
 * Supports: Anthropic, OpenAI, Ollama (no key needed).
 */

import type { CompleteFn } from "./semantic-extractor.js";

interface DirectLlmConfig {
  provider: string;
  model: string;
  apiKey?: string;
  baseUrl?: string;
}

/**
 * Create a CompleteFn that calls the provider API directly.
 * Returns null if the provider is not supported or config is incomplete.
 */
export function createDirectComplete(config: DirectLlmConfig): CompleteFn | null {
  const { provider, model, apiKey, baseUrl } = config;

  if (provider === "ollama") {
    return createOllamaComplete(model, baseUrl ?? "http://127.0.0.1:11434");
  }

  if (!apiKey) return null; // Need API key for cloud providers

  if (provider === "anthropic") {
    return createAnthropicComplete(model, apiKey, baseUrl);
  }

  if (provider === "openai") {
    return createOpenAIComplete(model, apiKey, baseUrl);
  }

  return null;
}

// ── Anthropic ───────────────────────────────────────────────────────────────

function createAnthropicComplete(model: string, apiKey: string, baseUrl?: string): CompleteFn {
  const url = `${baseUrl ?? "https://api.anthropic.com"}/v1/messages`;

  return async (params) => {
    const body = {
      model: params.model || model,
      max_tokens: params.maxTokens,
      temperature: params.temperature ?? 0.1,
      system: params.system,
      messages: params.messages.map((m) => ({
        role: m.role,
        content: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
      })),
    };

    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new Error(`Anthropic API error ${resp.status}: ${text.substring(0, 200)}`);
    }

    const data = await resp.json() as {
      content: Array<{ type: string; text: string }>;
    };

    return { content: data.content };
  };
}

// ── OpenAI ──────────────────────────────────────────────────────────────────

function createOpenAIComplete(model: string, apiKey: string, baseUrl?: string): CompleteFn {
  const url = `${baseUrl ?? "https://api.openai.com"}/v1/chat/completions`;

  return async (params) => {
    const messages: Array<{ role: string; content: string }> = [];

    if (params.system) {
      messages.push({ role: "system", content: params.system });
    }

    for (const m of params.messages) {
      messages.push({
        role: m.role,
        content: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
      });
    }

    const body = {
      model: params.model || model,
      max_tokens: params.maxTokens,
      temperature: params.temperature ?? 0.1,
      messages,
    };

    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new Error(`OpenAI API error ${resp.status}: ${text.substring(0, 200)}`);
    }

    const data = await resp.json() as {
      choices: Array<{ message: { content: string } }>;
    };

    const content = data.choices?.[0]?.message?.content ?? "";
    return { content: [{ type: "text", text: content }] };
  };
}

// ── Ollama ──────────────────────────────────────────────────────────────────

function createOllamaComplete(model: string, baseUrl: string): CompleteFn {
  const url = `${baseUrl}/api/chat`;

  return async (params) => {
    const messages: Array<{ role: string; content: string }> = [];

    if (params.system) {
      messages.push({ role: "system", content: params.system });
    }

    for (const m of params.messages) {
      messages.push({
        role: m.role,
        content: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
      });
    }

    const body = {
      model: params.model || model,
      messages,
      stream: false,
      options: {
        temperature: params.temperature ?? 0.1,
        num_predict: params.maxTokens ?? 1500,
      },
    };

    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30000), // Ollama can be slow on first load
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new Error(`Ollama API error ${resp.status}: ${text.substring(0, 200)}`);
    }

    const data = await resp.json() as {
      message: { content: string };
    };

    return { content: [{ type: "text", text: data.message?.content ?? "" }] };
  };
}
