/**
 * RSMA Historical Data Migration — backfill provenance_links.
 *
 * Migrates existing cross-object relationships from legacy join tables
 * into the unified provenance_links table. Safe to run multiple times
 * (INSERT OR IGNORE handles duplicates).
 *
 * Legacy tables migrated:
 * - entity_mentions → provenance_links (mentioned_in)
 * - claim_evidence → provenance_links (supports/contradicts)
 * - summary_messages → provenance_links (derived_from) [memory.db — future]
 * - entity_relations → provenance_links (relates_to)
 * - runbook_evidence → provenance_links (supported_by → supports)
 * - anti_runbook_evidence → provenance_links (supported_by → supports)
 */

import type { GraphDb } from "../relations/types.js";

interface MigrationStats {
  entityMentions: number;
  claimEvidence: number;
  entityRelations: number;
  runbookEvidence: number;
  antiRunbookEvidence: number;
  total: number;
  errors: number;
}

/**
 * Migrate all legacy join tables into provenance_links.
 * Safe to call repeatedly — uses INSERT OR IGNORE.
 */
export function migrateToProvenanceLinks(db: GraphDb): MigrationStats {
  const stats: MigrationStats = {
    entityMentions: 0,
    claimEvidence: 0,
    entityRelations: 0,
    runbookEvidence: 0,
    antiRunbookEvidence: 0,
    total: 0,
    errors: 0,
  };

  // entity_mentions → mentioned_in
  try {
    const result = db.prepare(`
      INSERT OR IGNORE INTO provenance_links (subject_id, predicate, object_id, confidence, detail)
      SELECT
        'entity:' || entity_id,
        'mentioned_in',
        source_type || ':' || source_id,
        1.0,
        source_detail
      FROM entity_mentions
      WHERE entity_id IS NOT NULL AND source_id IS NOT NULL
    `).run();
    stats.entityMentions = Number(result.changes);
  } catch (e) {
    stats.errors++;
  }

  // claim_evidence → supports/contradicts
  try {
    const result = db.prepare(`
      INSERT OR IGNORE INTO provenance_links (subject_id, predicate, object_id, confidence, detail)
      SELECT
        'claim:' || claim_id,
        CASE
          WHEN evidence_role = 'contradict' THEN 'contradicts'
          WHEN evidence_role = 'update' THEN 'supports'
          ELSE 'supports'
        END,
        source_type || ':' || source_id,
        COALESCE(confidence_delta, 1.0),
        source_detail
      FROM claim_evidence
      WHERE claim_id IS NOT NULL AND source_id IS NOT NULL
    `).run();
    stats.claimEvidence = Number(result.changes);
  } catch (e) {
    stats.errors++;
  }

  // entity_relations → relates_to
  try {
    const result = db.prepare(`
      INSERT OR IGNORE INTO provenance_links (subject_id, predicate, object_id, confidence, detail)
      SELECT
        'entity:' || subject_entity_id,
        'relates_to',
        'entity:' || object_entity_id,
        COALESCE(confidence, 1.0),
        predicate
      FROM entity_relations
      WHERE subject_entity_id IS NOT NULL AND object_entity_id IS NOT NULL
    `).run();
    stats.entityRelations = Number(result.changes);
  } catch (e) {
    stats.errors++;
  }

  // runbook_evidence → supports
  try {
    const result = db.prepare(`
      INSERT OR IGNORE INTO provenance_links (subject_id, predicate, object_id, confidence, detail)
      SELECT
        'procedure:' || runbook_id,
        'supports',
        'attempt:' || attempt_id,
        1.0,
        evidence_role
      FROM runbook_evidence
      WHERE runbook_id IS NOT NULL AND attempt_id IS NOT NULL
    `).run();
    stats.runbookEvidence = Number(result.changes);
  } catch (e) {
    stats.errors++;
  }

  // anti_runbook_evidence → supports
  try {
    const result = db.prepare(`
      INSERT OR IGNORE INTO provenance_links (subject_id, predicate, object_id, confidence, detail)
      SELECT
        'procedure:' || anti_runbook_id,
        'supports',
        'attempt:' || attempt_id,
        1.0,
        evidence_role
      FROM anti_runbook_evidence
      WHERE anti_runbook_id IS NOT NULL AND attempt_id IS NOT NULL
    `).run();
    stats.antiRunbookEvidence = Number(result.changes);
  } catch (e) {
    stats.errors++;
  }

  stats.total = stats.entityMentions + stats.claimEvidence + stats.entityRelations
    + stats.runbookEvidence + stats.antiRunbookEvidence;

  return stats;
}

/**
 * Check if migration has already been performed (any rows in provenance_links).
 */
export function isMigrationNeeded(db: GraphDb): boolean {
  try {
    const count = (db.prepare("SELECT COUNT(*) as cnt FROM provenance_links").get() as { cnt: number }).cnt;
    return count === 0;
  } catch {
    return false; // Table doesn't exist
  }
}
