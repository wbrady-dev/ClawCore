import { Type } from "@sinclair/typebox";
import type { LcmContextEngine } from "../engine.js";
import type { LcmDependencies } from "../types.js";
import type { AnyAgentTool } from "./common.js";
import {
  getRuntimeExpansionAuthManager,
  resolveDelegatedExpansionGrantId,
  wrapWithAuth,
} from "../expansion-auth.js";
import { decideLcmExpansionRouting } from "../expansion-policy.js";
import {
  ExpansionOrchestrator,
  distillForSubagent,
  type ExpansionResult,
} from "../expansion.js";
import { jsonResult } from "./common.js";
import { resolveLcmConversationScope } from "./lcm-conversation-scope.js";
import {
  normalizeSummaryIds,
  type DelegatedExpansionLoopResult,
} from "./lcm-expand-tool.delegation.js";

const LcmExpandSchema = Type.Object({
  summaryIds: Type.Optional(
    Type.Array(Type.String(), {
      description: "Summary IDs to expand (sum_xxx format). Required if query is not provided.",
    }),
  ),
  query: Type.Optional(
    Type.String({
      description:
        "Text query to grep for matching summaries before expanding. " +
        "If provided, summaryIds is ignored and the top grep results are expanded.",
    }),
  ),
  maxDepth: Type.Optional(
    Type.Number({
      description: "Max traversal depth per summary (default: 3).",
      minimum: 1,
    }),
  ),
  tokenCap: Type.Optional(
    Type.Number({
      description: "Max tokens across the entire expansion result.",
      minimum: 1,
    }),
  ),
  includeMessages: Type.Optional(
    Type.Boolean({
      description: "Whether to include raw source messages at leaf level (default: false).",
    }),
  ),
  conversationId: Type.Optional(
    Type.Number({
      description:
        "Conversation ID to scope the expansion to. If omitted, uses the current session's conversation.",
    }),
  ),
  allConversations: Type.Optional(
    Type.Boolean({
      description:
        "Set true to allow cross-conversation expansion for this agent. Ignored when conversationId is provided.",
    }),
  ),
  crossAgent: Type.Optional(
    Type.Boolean({
      description:
        "When combined with allConversations=true, allows expansion across all agents. Use sparingly.",
    }),
  ),
});

function makeEmptyExpansionResult(): ExpansionResult {
  return {
    expansions: [],
    citedIds: [],
    totalTokens: 0,
    truncated: false,
  };
}

type LcmDelegatedRunReference = {
  pass: number;
  status: "ok" | "timeout" | "error";
  runId: string;
  childSessionKey: string;
};

/**
 * Extract delegated run references for deterministic orchestration diagnostics.
 */
function toDelegatedRunReferences(
  delegated?: DelegatedExpansionLoopResult,
): LcmDelegatedRunReference[] | undefined {
  if (!delegated) {
    return undefined;
  }
  const refs = delegated.passes.map((pass) => ({
    pass: pass.pass,
    status: pass.status,
    runId: pass.runId,
    childSessionKey: pass.childSessionKey,
  }));
  return refs.length > 0 ? refs : undefined;
}

/**
 * Build stable debug metadata for route-vs-delegate orchestration decisions.
 */
function buildOrchestrationObservability(input: {
  policy: ReturnType<typeof decideLcmExpansionRouting>;
  executionPath: "direct" | "delegated" | "direct_fallback";
  delegated?: DelegatedExpansionLoopResult;
}) {
  return {
    decisionPath: {
      policyAction: input.policy.action,
      executionPath: input.executionPath,
    },
    policyReasons: input.policy.reasons,
    delegatedRunRefs: toDelegatedRunReferences(input.delegated),
  };
}

/**
 * Build the runtime LCM expansion tool with route-vs-delegate orchestration.
 */
export function createLcmExpandTool(input: {
  deps: LcmDependencies;
  lcm: LcmContextEngine;
  /** Runtime session key (used for delegated expansion auth scoping). */
  sessionId?: string;
  sessionKey?: string;
  agentId?: string;
}): AnyAgentTool {
  return {
    name: "cc_expand",
    label: "ThreadClaw Expand",
    description:
      "Expand compacted conversation summaries from ThreadClaw Memory. " +
      "Traverses the summary DAG to retrieve children and source messages. " +
      "Use this to drill into previously-compacted context when you need detail " +
      "that was summarised away. Provide either summaryIds (direct expansion) or " +
      "query (grep-first, then expand top matches). Returns a compact text payload " +
      "with cited IDs for follow-up.",
    parameters: LcmExpandSchema,
    async execute(_toolCallId, params) {
      try {
      const retrieval = input.lcm.getRetrieval();
      const orchestrator = new ExpansionOrchestrator(retrieval);
      const runtimeAuthManager = getRuntimeExpansionAuthManager();

      const p = params as Record<string, unknown>;
      const summaryIds = p.summaryIds as string[] | undefined;
      const query = typeof p.query === "string" ? p.query.trim() : undefined;
      const maxDepth = typeof p.maxDepth === "number" ? Math.trunc(p.maxDepth) : undefined;
      const requestedTokenCap = typeof p.tokenCap === "number" ? Math.trunc(p.tokenCap) : undefined;
      const tokenCap =
        typeof requestedTokenCap === "number" && Number.isFinite(requestedTokenCap)
          ? Math.max(1, requestedTokenCap)
          : undefined;
      const includeMessages = typeof p.includeMessages === "boolean" ? p.includeMessages : false;
      const sessionKey =
        (typeof input.sessionKey === "string" ? input.sessionKey : input.sessionId)?.trim() ?? "";
      if (!input.deps.isSubagentSessionKey(sessionKey)) {
        return jsonResult({
          error:
            "cc_expand is only available in sub-agent sessions. Use cc_recall to ask a focused question against expanded summaries, or cc_describe/cc_grep for lighter lookups.",
        });
      }
      // sessionKey is confirmed subagent at this point (early return above)
      const delegatedGrantId = resolveDelegatedExpansionGrantId(sessionKey) ?? undefined;
      const delegatedGrant =
        delegatedGrantId !== undefined ? runtimeAuthManager.getGrant(delegatedGrantId) : null;
      const authorizedOrchestrator =
        delegatedGrantId !== undefined ? wrapWithAuth(orchestrator, runtimeAuthManager) : null;

      if (!delegatedGrantId) {
        return jsonResult({
          error:
            "Delegated expansion requires a valid grant. This sub-agent session has no propagated expansion grant.",
        });
      }

      const conversationScope = await resolveLcmConversationScope({
        lcm: input.lcm,
        deps: input.deps,
        sessionId: input.sessionId,
        sessionKey: input.sessionKey,
        agentId: input.agentId,
        params: p,
      });

      const runExpand = async (input: {
        summaryIds: string[];
        conversationId: number;
        maxDepth?: number;
        tokenCap?: number;
        includeMessages?: boolean;
      }) => {
        if (!authorizedOrchestrator || !delegatedGrantId) {
          return orchestrator.expand(input);
        }
        return authorizedOrchestrator.expand(delegatedGrantId, input);
      };

      const resolvedConversationId =
        conversationScope.conversationId ??
        (delegatedGrant?.allowedConversationIds.length === 1
          ? delegatedGrant.allowedConversationIds[0]
          : undefined);

      if (query) {
        try {
          if (resolvedConversationId == null) {
            const result = await orchestrator.describeAndExpand({
              query,
              mode: "full_text",
              conversationId: undefined,
              maxDepth,
              tokenCap,
            });
            const text = distillForSubagent(result);
            const policy = decideLcmExpansionRouting({
              intent: "query_probe",
              query,
              requestedMaxDepth: maxDepth,
              candidateSummaryCount: result.expansions.length,
              tokenCap: tokenCap ?? Number.MAX_SAFE_INTEGER,
              includeMessages: false,
            });
            return {
              content: [{ type: "text", text }],
              details: {
                expansionCount: result.expansions.length,
                citedIds: result.citedIds,
                totalTokens: result.totalTokens,
                truncated: result.truncated,
                policy,
                executionPath: "direct",
                observability: buildOrchestrationObservability({
                  policy,
                  executionPath: "direct",
                }),
              },
            };
          }
          const grepResult = await retrieval.grep({
            query,
            mode: "full_text",
            scope: "summaries",
            conversationId: resolvedConversationId,
          });
          const matchedSummaryIds = grepResult.summaries.map((entry) => entry.summaryId);
          const policy = decideLcmExpansionRouting({
            intent: "query_probe",
            query,
            requestedMaxDepth: maxDepth,
            candidateSummaryCount: matchedSummaryIds.length,
            tokenCap: tokenCap ?? Number.MAX_SAFE_INTEGER,
            includeMessages: false,
          });
          // cc_expand runs in subagent context only (early return above) — no recursive delegation
          const result =
            matchedSummaryIds.length === 0
              ? makeEmptyExpansionResult()
              : await runExpand({
                  summaryIds: matchedSummaryIds,
                  maxDepth,
                  tokenCap,
                  includeMessages: false,
                  conversationId: resolvedConversationId,
                });
          const text = distillForSubagent(result);
          return {
            content: [{ type: "text", text }],
            details: {
              expansionCount: result.expansions.length,
              citedIds: result.citedIds,
              totalTokens: result.totalTokens,
              truncated: result.truncated,
              policy,
              executionPath: "direct" as const,
              observability: buildOrchestrationObservability({
                policy,
                executionPath: "direct",
              }),
            },
          };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return jsonResult({ error: message });
        }
      }

      if (summaryIds && summaryIds.length > 0) {
        try {
          if (conversationScope.conversationId != null) {
            const outOfScope: string[] = [];
            for (const summaryId of summaryIds) {
              const described = await retrieval.describe(summaryId);
              if (
                described?.type === "summary" &&
                described.summary?.conversationId !== conversationScope.conversationId
              ) {
                outOfScope.push(summaryId);
              }
            }
            if (outOfScope.length > 0) {
              return jsonResult({
                error:
                  `Some summaryIds are outside conversation ${conversationScope.conversationId}: ` +
                  outOfScope.join(", "),
                hint: "Use allConversations=true for cross-conversation expansion.",
              });
            }
          }

          const policy = decideLcmExpansionRouting({
            intent: "explicit_expand",
            requestedMaxDepth: maxDepth,
            candidateSummaryCount: summaryIds.length,
            tokenCap: tokenCap ?? Number.MAX_SAFE_INTEGER,
            includeMessages,
          });
          const normalizedSummaryIds = normalizeSummaryIds(summaryIds);
          // cc_expand runs in subagent context only — no recursive delegation
          if (resolvedConversationId == null) {
            return jsonResult({
              error: "Unable to resolve conversation scope for expansion. Provide conversationId explicitly.",
            });
          }
          const result = await runExpand({
            summaryIds: normalizedSummaryIds,
            maxDepth,
            tokenCap,
            includeMessages,
            conversationId: resolvedConversationId,
          });
          const text = distillForSubagent(result);
          return {
            content: [{ type: "text", text }],
            details: {
              expansionCount: result.expansions.length,
              citedIds: result.citedIds,
              totalTokens: result.totalTokens,
              truncated: result.truncated,
              policy,
              executionPath: "direct" as const,
              observability: buildOrchestrationObservability({
                policy,
                executionPath: "direct",
              }),
            },
          };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return jsonResult({ error: message });
        }
      }

      return jsonResult({
        error: "Either summaryIds or query must be provided.",
      });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return jsonResult({ error: `cc_expand failed: ${message}` });
      }
    },
  };
}
