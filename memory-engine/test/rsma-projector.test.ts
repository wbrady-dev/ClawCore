/**
 * RSMA StoreProjector Tests — provenance link writing validation.
 */

import { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it } from "vitest";
import { runGraphMigrations } from "../src/relations/schema.js";
import type { GraphDb } from "../src/relations/types.js";
import {
  insertProvenanceLink,
  getProvenanceLinksForSubject,
  getProvenanceLinksForObject,
  recordSupersession,
  recordConflict,
  recordMention,
  recordEvidence,
  recordDerivation,
  recordResolution,
  projectProvenance,
} from "../src/ontology/projector.js";
import type { MemoryObject } from "../src/ontology/types.js";

let db: GraphDb;

function createDb(): GraphDb {
  const d = new DatabaseSync(":memory:");
  d.exec("PRAGMA journal_mode = WAL");
  d.exec("PRAGMA foreign_keys = ON");
  return d as unknown as GraphDb;
}

beforeEach(() => {
  db = createDb();
  runGraphMigrations(db);
});

function linkCount(): number {
  return (db.prepare("SELECT COUNT(*) as cnt FROM provenance_links").get() as { cnt: number }).cnt;
}

// ============================================================================
// insertProvenanceLink
// ============================================================================

describe("RSMA Projector: insertProvenanceLink", () => {
  it("inserts a valid link", () => {
    insertProvenanceLink(db, "claim:1", "supports", "claim:2", 0.9, "test");
    expect(linkCount()).toBe(1);
    const links = getProvenanceLinksForSubject(db, "claim:1");
    expect(links.length).toBe(1);
    expect(links[0].predicate).toBe("supports");
    expect(links[0].object_id).toBe("claim:2");
    expect(links[0].confidence).toBe(0.9);
    expect(links[0].detail).toBe("test");
  });

  it("ignores duplicates silently", () => {
    insertProvenanceLink(db, "claim:1", "supports", "claim:2", 0.9);
    insertProvenanceLink(db, "claim:1", "supports", "claim:2", 0.8); // duplicate
    expect(linkCount()).toBe(1);
  });

  it("allows same pair with different predicates", () => {
    insertProvenanceLink(db, "claim:1", "supports", "claim:2", 0.9);
    insertProvenanceLink(db, "claim:1", "contradicts", "claim:2", 0.7);
    expect(linkCount()).toBe(2);
  });

  it("clamps confidence to [0.0, 1.0]", () => {
    insertProvenanceLink(db, "a", "supports", "b", 1.5);
    const links = getProvenanceLinksForSubject(db, "a");
    expect(links[0].confidence).toBe(1.0);
  });

  it("clamps negative confidence to 0.0", () => {
    insertProvenanceLink(db, "a", "supports", "b", -0.5);
    const links = getProvenanceLinksForSubject(db, "a");
    expect(links[0].confidence).toBe(0.0);
  });
});

// ============================================================================
// Query helpers
// ============================================================================

describe("RSMA Projector: getProvenanceLinksForSubject", () => {
  it("returns all links for a subject", () => {
    insertProvenanceLink(db, "claim:1", "supports", "msg:10");
    insertProvenanceLink(db, "claim:1", "derived_from", "msg:11");
    const links = getProvenanceLinksForSubject(db, "claim:1");
    expect(links.length).toBe(2);
  });

  it("filters by predicate", () => {
    insertProvenanceLink(db, "claim:1", "supports", "msg:10");
    insertProvenanceLink(db, "claim:1", "derived_from", "msg:11");
    const links = getProvenanceLinksForSubject(db, "claim:1", "supports");
    expect(links.length).toBe(1);
    expect(links[0].predicate).toBe("supports");
  });

  it("returns empty for unknown subject", () => {
    expect(getProvenanceLinksForSubject(db, "nonexistent")).toEqual([]);
  });
});

describe("RSMA Projector: getProvenanceLinksForObject", () => {
  it("returns all links pointing TO an object", () => {
    insertProvenanceLink(db, "claim:1", "supports", "msg:10");
    insertProvenanceLink(db, "claim:2", "supports", "msg:10");
    const links = getProvenanceLinksForObject(db, "msg:10");
    expect(links.length).toBe(2);
  });

  it("filters by predicate", () => {
    insertProvenanceLink(db, "claim:1", "supports", "msg:10");
    insertProvenanceLink(db, "claim:2", "contradicts", "msg:10");
    const links = getProvenanceLinksForObject(db, "msg:10", "supports");
    expect(links.length).toBe(1);
  });
});

// ============================================================================
// High-level recording functions
// ============================================================================

describe("RSMA Projector: recordSupersession", () => {
  it("creates a supersedes link", () => {
    recordSupersession(db, "claim:2", "claim:1", "correction: actually");
    const links = getProvenanceLinksForSubject(db, "claim:2", "supersedes");
    expect(links.length).toBe(1);
    expect(links[0].object_id).toBe("claim:1");
    expect(links[0].detail).toBe("correction: actually");
  });
});

describe("RSMA Projector: recordConflict", () => {
  it("creates bidirectional contradicts links", () => {
    recordConflict(db, "conflict:1", "claim:1", "claim:2", "staging DB disagreement");
    const links = getProvenanceLinksForSubject(db, "conflict:1", "contradicts");
    expect(links.length).toBe(2);
    const targets = links.map((l) => l.object_id).sort();
    expect(targets).toEqual(["claim:1", "claim:2"]);
  });
});

describe("RSMA Projector: recordMention", () => {
  it("creates a mentioned_in link", () => {
    recordMention(db, "entity:1", "msg:10", 0.8);
    const links = getProvenanceLinksForSubject(db, "entity:1", "mentioned_in");
    expect(links.length).toBe(1);
    expect(links[0].confidence).toBe(0.8);
  });
});

describe("RSMA Projector: recordEvidence", () => {
  it("creates a supports link", () => {
    recordEvidence(db, "claim:1", "msg:10", "supports", 0.95, "explicit user statement");
    const links = getProvenanceLinksForSubject(db, "claim:1", "supports");
    expect(links.length).toBe(1);
    expect(links[0].detail).toBe("explicit user statement");
  });

  it("creates a contradicts link", () => {
    recordEvidence(db, "claim:1", "msg:11", "contradicts", 0.7);
    const links = getProvenanceLinksForSubject(db, "claim:1", "contradicts");
    expect(links.length).toBe(1);
  });
});

describe("RSMA Projector: recordDerivation", () => {
  it("creates a derived_from link", () => {
    recordDerivation(db, "summary:1", "msg:10");
    recordDerivation(db, "summary:1", "msg:11");
    const links = getProvenanceLinksForSubject(db, "summary:1", "derived_from");
    expect(links.length).toBe(2);
  });
});

describe("RSMA Projector: recordResolution", () => {
  it("creates a resolved_by link", () => {
    recordResolution(db, "conflict:1", "decision:5", "user confirmed Postgres");
    const links = getProvenanceLinksForSubject(db, "conflict:1", "resolved_by");
    expect(links.length).toBe(1);
    expect(links[0].detail).toBe("user confirmed Postgres");
  });
});

// ============================================================================
// projectProvenance
// ============================================================================

describe("RSMA Projector: projectProvenance", () => {
  it("writes all links for a MemoryObject", () => {
    const obj: MemoryObject = {
      id: "claim:42",
      kind: "claim",
      content: "postgres is_used_for: staging",
      provenance: { source_kind: "extraction", source_id: "msg:1", actor: "system", trust: 0.7 },
      confidence: 0.8,
      freshness: 0.9,
      provisional: false,
      status: "active",
      observed_at: new Date().toISOString(),
      scope_id: 1,
      influence_weight: "standard",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    projectProvenance(db, obj, [
      { predicate: "supports", targetId: "msg:1", confidence: 0.9 },
      { predicate: "mentioned_in", targetId: "doc:5" },
    ]);

    expect(linkCount()).toBe(2);
    const links = getProvenanceLinksForSubject(db, "claim:42");
    expect(links.length).toBe(2);
  });

  it("records supersession link when superseded_by is set", () => {
    const obj: MemoryObject = {
      id: "claim:1",
      kind: "claim",
      content: "old claim",
      provenance: { source_kind: "extraction", source_id: "msg:1", actor: "system", trust: 0.7 },
      confidence: 0.8,
      freshness: 0.9,
      provisional: false,
      status: "superseded",
      superseded_by: "claim:2",
      observed_at: new Date().toISOString(),
      scope_id: 1,
      influence_weight: "standard",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    projectProvenance(db, obj);
    const links = getProvenanceLinksForSubject(db, "claim:2", "supersedes");
    expect(links.length).toBe(1);
    expect(links[0].object_id).toBe("claim:1");
  });
});
