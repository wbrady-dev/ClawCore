import type { AnyAgentTool as OpenClawAnyAgentTool } from "openclaw/plugin-sdk";

export type AnyAgentTool = OpenClawAnyAgentTool;

/** Render structured payloads as deterministic text tool results. */
export function jsonResult(payload: unknown): {
  content: Array<{ type: "text"; text: string }>;
  details: unknown;
} {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(payload, null, 2),
      },
    ],
    details: payload,
  };
}