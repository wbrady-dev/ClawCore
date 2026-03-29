/**
 * Python server lifecycle manager — lazy-spawn with idle shutdown.
 *
 * When external embedding/reranking endpoints are configured, the Python
 * server is not needed. When local models are required, the server is
 * spawned on-demand and shut down after an idle timeout.
 */

import { config } from "../config.js";
import { logger } from "./logger.js";
import { startModelServer, getModelPort } from "../tui/platform.js";

const HEALTH_TIMEOUT_MS = 3000;
const SPAWN_WAIT_MS = 60_000;
const HEALTH_POLL_MS = 500;

let lastRequestAt = 0;
let idleTimer: NodeJS.Timeout | null = null;
let spawnPromise: Promise<void> | null = null;

/**
 * Returns true if external endpoints are configured for both embeddings
 * and reranking, meaning the Python server is not needed.
 */
export function isPythonNeeded(): boolean {
  if (process.env.PYTHON_SERVER_REQUIRED === "true") return true;

  const embeddingUrl = config.embedding?.url ?? "";
  const rerankerUrl = config.reranker?.url ?? "";

  const isLocal = (url: string) => {
    if (!url) return true; // no URL = needs local
    try {
      const u = new URL(url);
      const host = u.hostname;
      return host === "127.0.0.1" || host === "localhost" || host === "::1";
    } catch {
      return true;
    }
  };

  // If both point to external services, Python is not needed
  return isLocal(embeddingUrl) || isLocal(rerankerUrl);
}

/** Check if the Python server is healthy. */
async function isHealthy(): Promise<boolean> {
  try {
    const port = getModelPort();
    const res = await fetch(`http://127.0.0.1:${port}/health`, {
      signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Ensure the Python server is running. If not, spawn it and wait for health.
 * Uses a mutex to prevent concurrent spawn attempts.
 */
export async function ensurePythonRunning(): Promise<void> {
  if (!isPythonNeeded()) return;

  // Track activity for idle shutdown
  lastRequestAt = Date.now();
  startIdleTimer();

  // Already healthy?
  if (await isHealthy()) return;

  // Mutex: if a spawn is already in progress, wait for it
  if (spawnPromise) {
    await spawnPromise;
    return;
  }

  spawnPromise = doSpawn();
  try {
    await spawnPromise;
  } finally {
    spawnPromise = null;
  }
}

async function doSpawn(): Promise<void> {
  logger.info("Spawning Python model server on-demand...");
  const result = startModelServer();
  if (!result.success) {
    logger.warn({ error: result.error }, "Failed to spawn Python server");
    throw new Error(`Python server spawn failed: ${result.error}`);
  }

  // Wait for health
  const deadline = Date.now() + SPAWN_WAIT_MS;
  while (Date.now() < deadline) {
    if (await isHealthy()) {
      logger.info("Python model server is ready");
      return;
    }
    await new Promise((r) => setTimeout(r, HEALTH_POLL_MS));
  }

  throw new Error("Python server failed to become healthy within 60s");
}

/** Gracefully shut down the Python server. */
export async function shutdownPython(): Promise<void> {
  if (idleTimer) {
    clearInterval(idleTimer);
    idleTimer = null;
  }
  try {
    const port = getModelPort();
    await fetch(`http://127.0.0.1:${port}/shutdown`, {
      method: "POST",
      signal: AbortSignal.timeout(5000),
    });
    logger.info("Python server shutdown requested");
  } catch {
    // Server may already be down
  }
}

/** Start the idle timer that shuts down Python after inactivity. */
function startIdleTimer(): void {
  if (idleTimer) return;
  const timeoutMs = parseInt(process.env.PYTHON_IDLE_TIMEOUT_MS ?? "300000", 10);
  if (timeoutMs <= 0) return; // disabled

  idleTimer = setInterval(async () => {
    if (Date.now() - lastRequestAt > timeoutMs) {
      logger.info("Python server idle timeout — shutting down");
      await shutdownPython();
    }
  }, 60_000);
  // Don't keep the process alive for this timer
  idleTimer.unref();
}

/** Get the current Python server status for display. */
export async function getPythonStatus(): Promise<"external" | "running" | "idle" | "off"> {
  if (!isPythonNeeded()) return "external";
  if (await isHealthy()) return "running";
  return "off";
}
