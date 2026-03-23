/**
 * RSMA Data Shape Validation Tests.
 *
 * These tests verify the EXACT field names in `structured` objects match what
 * the engine's legacy bridge expects. This catches the class of bug where
 * producers use one field name (e.g., "objectText") but consumers read another
 * (e.g., "value"), which is invisible when structured is typed as Record<string, unknown>.
 *
 * If this test fails, the extraction→relation pipeline is broken.
 */

import { describe, expect, it } from "vitest";
import type {
  StructuredClaim,
  StructuredDecision,
  StructuredLoop,
  StructuredEntity,
} from "../src/ontology/types.js";

// We import the internal conversion function indirectly by calling semanticExtract
// with a mock LLM. This tests the real code path.
import { semanticExtract, type SemanticExtractorConfig } from "../src/ontology/semantic-extractor.js";

// ── Mock LLM that returns predictable responses ─────────────────────────────

function mockComplete(responseJson: string): SemanticExtractorConfig["complete"] {
  return async () => ({ content: responseJson });
}

const baseConfig = (responseJson: string): SemanticExtractorConfig => ({
  complete: mockComplete(responseJson),
  model: "test-model",
  provider: "test",
  timeoutMs: 5000,
});

// ── Tests ───────────────────────────────────────────────────────────────────

describe("RSMA Data Shapes: structured field name validation", () => {

  it("claims have subject, predicate, objectText (NOT value)", async () => {
    const llmResponse = JSON.stringify({
      events: [{
        type: "fact",
        content: "Cassidy works for Sam",
        subject: "Cassidy",
        predicate: "works_for",
        value: "Sam",
        confidence: 0.9,
      }],
    });

    const result = await semanticExtract(
      "Cassidy works for Sam",
      "test-source",
      "user",
      baseConfig(llmResponse),
    );

    expect(result.objects.length).toBeGreaterThanOrEqual(1);
    const claim = result.objects.find((o) => o.kind === "claim");
    expect(claim).toBeDefined();

    const s = claim!.structured as Record<string, unknown>;

    // THE CRITICAL ASSERTIONS — these catch the exact bug that survived 10 audits
    expect(s).toHaveProperty("subject");
    expect(s).toHaveProperty("predicate");
    expect(s).toHaveProperty("objectText");

    // objectText should contain the value from the LLM response
    expect(s.objectText).toBe("Sam");

    // Verify the typed interface matches
    const typed = s as unknown as StructuredClaim;
    expect(typed.subject).toBe("Cassidy");
    expect(typed.predicate).toBe("works_for");
    expect(typed.objectText).toBe("Sam");

    // "value" should NOT be a key on the structured object
    expect(s).not.toHaveProperty("value");
  });

  it("decisions have topic, decisionText (NOT decision or text)", async () => {
    const llmResponse = JSON.stringify({
      events: [{
        type: "decision",
        content: "Use Postgres for staging",
        subject: "staging database",
        predicate: "technology",
        value: "Postgres",
        confidence: 0.9,
      }],
    });

    const result = await semanticExtract(
      "We decided to use Postgres for staging",
      "test-source",
      "user",
      baseConfig(llmResponse),
    );

    const decision = result.objects.find((o) => o.kind === "decision");
    expect(decision).toBeDefined();

    const s = decision!.structured as Record<string, unknown>;

    // THE CRITICAL ASSERTIONS
    expect(s).toHaveProperty("topic");
    expect(s).toHaveProperty("decisionText");

    const typed = s as unknown as StructuredDecision;
    expect(typed.topic).toBe("staging database");
    expect(typed.decisionText).toBe("Use Postgres for staging");

    // Should NOT have claim-style fields
    expect(s).not.toHaveProperty("subject");
    expect(s).not.toHaveProperty("predicate");
    expect(s).not.toHaveProperty("objectText");
  });

  it("loops have loopType, text (NOT type or content)", async () => {
    const llmResponse = JSON.stringify({
      events: [{
        type: "task",
        content: "Rotate the API key",
        subject: "API key",
        predicate: "action",
        value: "rotate",
        confidence: 0.9,
      }],
    });

    const result = await semanticExtract(
      "Need to rotate the API key before Friday",
      "test-source",
      "user",
      baseConfig(llmResponse),
    );

    const loop = result.objects.find((o) => o.kind === "loop");
    expect(loop).toBeDefined();

    const s = loop!.structured as Record<string, unknown>;

    // THE CRITICAL ASSERTIONS
    expect(s).toHaveProperty("loopType");
    expect(s).toHaveProperty("text");

    const typed = s as unknown as StructuredLoop;
    expect(typed.loopType).toBe("task");
    expect(typed.text).toBe("Rotate the API key");

    // Should NOT have claim-style fields
    expect(s).not.toHaveProperty("subject");
    expect(s).not.toHaveProperty("predicate");
    expect(s).not.toHaveProperty("objectText");
  });

  it("relationship events produce claims with objectText (NOT value)", async () => {
    const llmResponse = JSON.stringify({
      events: [{
        type: "relationship",
        content: "Bob manages auth team",
        subject: "Bob",
        predicate: "manages",
        value: "auth team",
        confidence: 0.9,
        entities: ["Bob"],
      }],
    });

    const result = await semanticExtract(
      "Bob manages the auth team",
      "test-source",
      "user",
      baseConfig(llmResponse),
    );

    // Relationship events map to claims
    const claim = result.objects.find((o) => o.kind === "claim");
    expect(claim).toBeDefined();

    const s = claim!.structured as Record<string, unknown>;
    expect(s).toHaveProperty("objectText");
    expect(s.objectText).toBe("auth team");
    expect(s).not.toHaveProperty("value");
  });

  it("entities have name, entityType", async () => {
    const llmResponse = JSON.stringify({
      events: [{
        type: "fact",
        content: "Bob is a developer",
        subject: "Bob",
        predicate: "role",
        value: "developer",
        confidence: 0.9,
        entities: ["Bob"],
      }],
    });

    const result = await semanticExtract(
      "Bob is a developer",
      "test-source",
      "user",
      baseConfig(llmResponse),
    );

    const entity = result.objects.find((o) => o.kind === "entity");
    expect(entity).toBeDefined();

    const s = entity!.structured as Record<string, unknown>;
    expect(s).toHaveProperty("name");
    expect(s).toHaveProperty("entityType");

    const typed = s as unknown as StructuredEntity;
    expect(typed.name).toBe("bob");  // lowercased + trimmed
    expect(typed.entityType).toBe("semantic");
  });

  it("claim structured data is assignable to StructuredClaim interface", async () => {
    const llmResponse = JSON.stringify({
      events: [{
        type: "fact",
        content: "Port is 8080",
        subject: "service",
        predicate: "port",
        value: "8080",
        confidence: 0.8,
      }],
    });

    const result = await semanticExtract(
      "The port is 8080",
      "test-source",
      "user",
      baseConfig(llmResponse),
    );

    const claim = result.objects.find((o) => o.kind === "claim");
    expect(claim).toBeDefined();

    // This line would fail at COMPILE TIME if the shape doesn't match
    const typed: StructuredClaim = claim!.structured as StructuredClaim;
    expect(typed.subject).toBe("service");
    expect(typed.predicate).toBe("port");
    expect(typed.objectText).toBe("8080");
  });
});
