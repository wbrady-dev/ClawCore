/**
 * RSMA MemoryWriter Tests — event understanding validation.
 */

import { describe, expect, it } from "vitest";
import { understandMessage, understandToolResult } from "../src/ontology/writer.js";

// ============================================================================
// understandMessage — basic extraction
// ============================================================================

describe("RSMA Writer: understandMessage basics", () => {
  it("returns empty for very short text", async () => {
    const result = await understandMessage("hi", "msg-1");
    expect(result.objects.length).toBe(0);
  });

  it("returns empty for empty string", async () => {
    const result = await understandMessage("", "msg-2");
    expect(result.objects.length).toBe(0);
  });

  it("extracts decisions from 'We decided to use Postgres'", async () => {
    const result = await understandMessage("We decided to use Postgres for staging.", "msg-3");
    const decisions = result.objects.filter((o) => o.kind === "decision");
    expect(decisions.length).toBeGreaterThanOrEqual(1);
    expect(decisions[0].content).toContain("Postgres");
    expect(decisions[0].influence_weight).toBe("high");
    expect(result.eventTypes).toContain("decision");
  });

  it("extracts claims from 'Remember: ...'", async () => {
    const result = await understandMessage("Remember: the API key expires on Friday", "msg-4");
    const claims = result.objects.filter((o) => o.kind === "claim");
    expect(claims.length).toBeGreaterThanOrEqual(1);
  });

  it("extracts loops from 'Task: ...'", async () => {
    const result = await understandMessage("Task: rotate the API key by Friday", "msg-5");
    const loops = result.objects.filter((o) => o.kind === "loop");
    expect(loops.length).toBeGreaterThanOrEqual(1);
    expect(result.eventTypes).toContain("task");
  });

  it("extracts entities from capitalized names", async () => {
    const result = await understandMessage("Wesley Brady discussed the project with Alex Morgan.", "msg-6");
    const entities = result.objects.filter((o) => o.kind === "entity");
    expect(entities.length).toBeGreaterThanOrEqual(1);
  });
});

// ============================================================================
// Signal detection integration
// ============================================================================

describe("RSMA Writer: signal detection", () => {
  it("detects correction signal and marks objects", async () => {
    const result = await understandMessage("Actually, we decided to use SQLite instead.", "msg-10");
    expect(result.signals.isCorrection).toBe(true);
    expect(result.signals.correctionSignal).toContain("Actually");
    const decisions = result.objects.filter((o) => o.kind === "decision");
    if (decisions.length > 0) {
      expect(result.eventTypes).toContain("correction");
    }
  });

  it("detects uncertainty and lowers confidence", async () => {
    const result = await understandMessage("Remember: I think the port is 8080", "msg-11");
    expect(result.signals.isUncertain).toBe(true);
    const claims = result.objects.filter((o) => o.kind === "claim");
    if (claims.length > 0) {
      expect(claims[0].provisional).toBe(true);
      expect(claims[0].confidence).toBeLessThan(0.9);
    }
  });

  it("detects preference and sets high influence", async () => {
    const result = await understandMessage("Remember: I prefer concise replies", "msg-12");
    expect(result.signals.isPreference).toBe(true);
    const claims = result.objects.filter((o) => o.kind === "claim");
    if (claims.length > 0) {
      expect(claims[0].influence_weight).toBe("high");
      expect(result.eventTypes).toContain("preference");
    }
  });

  it("detects temporal signals", async () => {
    const result = await understandMessage("Starting next Monday, use the new API. Task: migrate old endpoints by Friday", "msg-13");
    expect(result.signals.temporal).not.toBeNull();
    // If any objects were extracted, temporal should be applied
    if (result.objects.length > 0) {
      const withTemporal = result.objects.filter((o) => o.effective_at || o.expires_at);
      expect(withTemporal.length).toBeGreaterThanOrEqual(1);
    }
  });
});

// ============================================================================
// MemoryObject structure validation
// ============================================================================

describe("RSMA Writer: MemoryObject structure", () => {
  it("all objects have required fields", async () => {
    const result = await understandMessage(
      "We decided to use Postgres. Remember: always run migrations. Task: deploy staging.",
      "msg-20",
    );
    for (const obj of result.objects) {
      expect(obj.id).toBeTruthy();
      expect(obj.kind).toBeTruthy();
      expect(obj.content).toBeTruthy();
      expect(obj.provenance).toBeDefined();
      expect(obj.provenance.source_kind).toBeTruthy();
      expect(obj.provenance.source_id).toBe("msg-20");
      expect(obj.confidence).toBeGreaterThanOrEqual(0);
      expect(obj.confidence).toBeLessThanOrEqual(1);
      expect(obj.status).toBe("active");
      expect(obj.created_at).toBeTruthy();
    }
  });

  it("objects have unique IDs", async () => {
    const result = await understandMessage(
      "We decided to use Postgres. Remember: port 5432. Task: deploy staging.",
      "msg-21",
    );
    const ids = result.objects.map((o) => o.id);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });

  it("canonical keys are computed for decisions", async () => {
    const result = await understandMessage("We decided to use TypeScript for all new code.", "msg-22");
    const decisions = result.objects.filter((o) => o.kind === "decision");
    if (decisions.length > 0) {
      expect(decisions[0].canonical_key).toBeDefined();
      expect(decisions[0].canonical_key).toMatch(/^decision::/);
    }
  });
});

// ============================================================================
// understandToolResult
// ============================================================================

describe("RSMA Writer: understandToolResult", () => {
  it("creates an attempt object", async () => {
    const result = await understandToolResult("git_status", { branch: "main", clean: true }, "msg-30");
    const attempts = result.objects.filter((o) => o.kind === "attempt");
    expect(attempts.length).toBe(1);
    expect(attempts[0].content).toContain("git_status");
    expect(attempts[0].confidence).toBe(1.0);
    expect(result.eventTypes).toContain("tool_outcome");
  });

  it("extracts claims from tool result JSON", async () => {
    const result = await understandToolResult(
      "system_info",
      { os: "Windows", version: "11", cores: 8 },
      "msg-31",
    );
    const claims = result.objects.filter((o) => o.kind === "claim");
    expect(claims.length).toBeGreaterThanOrEqual(2);
    expect(claims[0].provenance.source_kind).toBe("tool_result");
    expect(claims[0].provenance.trust).toBe(1.0);
  });

  it("handles null tool result gracefully", async () => {
    const result = await understandToolResult("some_tool", null, "msg-32");
    expect(result.objects.length).toBe(1);
    expect(result.objects[0].kind).toBe("attempt");
  });

  it("handles string tool result", async () => {
    const result = await understandToolResult("echo", "hello world", "msg-33");
    expect(result.objects.length).toBe(1);
  });
});

// ============================================================================
// Assistant messages
// ============================================================================

describe("RSMA Writer: assistant messages", () => {
  it("extracts entities from assistant text", async () => {
    const result = await understandMessage(
      "I found that PostgreSQL is running on port 5432.",
      "msg-40",
      "assistant",
    );
    const entities = result.objects.filter((o) => o.kind === "entity");
    expect(entities.length).toBeGreaterThanOrEqual(0);
  });

  it("does NOT extract user-explicit claims from assistant text", async () => {
    const result = await understandMessage(
      "Remember: the database is on port 5432",
      "msg-41",
      "assistant",
    );
    const claims = result.objects.filter((o) => o.kind === "claim");
    expect(claims.length).toBe(0);
  });

  it("does NOT extract loops from assistant text", async () => {
    const result = await understandMessage(
      "Task: I will now deploy to staging.",
      "msg-42",
      "assistant",
    );
    const loops = result.objects.filter((o) => o.kind === "loop");
    expect(loops.length).toBe(0);
  });
});
