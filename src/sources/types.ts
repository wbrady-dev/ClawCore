/**
 * ClawCore Source Adapter System — Types
 *
 * Every external data source implements SourceAdapter.
 * Local directory watching and polling-based adapters share this interface.
 */

export type SourceType = "realtime" | "polling";

export interface SourceStatus {
  state: "watching" | "syncing" | "idle" | "error" | "disabled" | "unavailable";
  lastSync?: Date;
  nextSync?: Date;
  docCount: number;
  error?: string;
}

export interface SourceConfig {
  enabled: boolean;
  /** Seconds between sync checks (polling adapters only) */
  syncInterval: number;
  /** Source path → ClawCore collection mapping */
  collections: { path: string; collection: string }[];
  /** File extensions to sync (e.g., [".md", ".pdf"]) */
  fileTypes?: string[];
  /** Skip files over this size in bytes */
  maxFileSize?: number;
}

export interface ChangeSet {
  added: StagedFile[];
  modified: StagedFile[];
  removed: string[]; // source IDs to remove
}

export interface StagedFile {
  /** Unique ID for this file in the source (path, page ID, etc.) */
  sourceId: string;
  /** Local path to the staged file (after download) */
  localPath: string;
  /** Target collection */
  collection: string;
  /** Optional tags */
  tags?: string[];
  /** Remote modification timestamp (ISO 8601) — used for change detection */
  remoteTimestamp?: string;
}

export interface SourceAdapter {
  /** Unique adapter ID (e.g., "local", "obsidian", "gdrive") */
  id: string;
  /** Human-readable name (e.g., "Local Directories", "Obsidian Vault") */
  name: string;
  /** Whether this adapter watches in real-time or polls on an interval */
  type: SourceType;

  /** Can this source work on this system? */
  isAvailable(): Promise<boolean>;
  /** Why not available? */
  availabilityReason(): string;

  /** Default configuration */
  defaultConfig(): SourceConfig;
  /** Current status */
  getStatus(): SourceStatus;

  /** Start watching/syncing (called when enabled) */
  start(cfg: SourceConfig): Promise<void>;
  /** Stop watching/syncing */
  stop(): Promise<void>;

  /**
   * For polling adapters: detect changes since last sync.
   * For real-time adapters: not used (they auto-ingest via watcher).
   */
  detectChanges?(): Promise<ChangeSet>;
  /** Download changed files to staging (polling adapters) */
  downloadToStaging?(changes: ChangeSet): Promise<StagedFile[]>;
  /** Clean up staging files after ingestion */
  cleanup?(staged: StagedFile[]): void;
}
