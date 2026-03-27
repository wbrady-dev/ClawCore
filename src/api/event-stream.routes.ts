import type { FastifyInstance } from "fastify";
import { onPipelineEvent, listenerCount } from "../analytics/event-stream.js";
import { isLocalRequest } from "./guards.js";

/**
 * GET /events — Server-Sent Events stream for real-time pipeline monitoring.
 * Used by Neural Viz to show live pings as Copper processes queries.
 *
 * Sends events as SSE `data:` lines with JSON payloads.
 */
export function registerEventStreamRoute(server: FastifyInstance) {
  server.get("/events", async (req, reply) => {
    if (!isLocalRequest(req)) {
      return reply.status(403).send({ error: "Forbidden" });
    }
    // SSE headers — keep connection alive, no buffering
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      "Access-Control-Allow-Origin": "*",
      "X-Accel-Buffering": "no",
    });

    // Send initial connected event
    reply.raw.write(`data: ${JSON.stringify({ ts: Date.now(), type: "connected", detail: { listeners: listenerCount() + 1 } })}\n\n`);

    // Keepalive every 15s (.unref so it doesn't block process.exit)
    const keepalive = setInterval(() => {
      try {
        reply.raw.write(`: keepalive ${Date.now()}\n\n`);
      } catch {
        cleanup();
      }
    }, 15000);
    if (keepalive.unref) keepalive.unref();

    // Subscribe to pipeline events
    const unsub = onPipelineEvent((event) => {
      try {
        reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
      } catch {
        cleanup();
      }
    });

    let cleaned = false;
    function cleanup() {
      if (cleaned) return;
      cleaned = true;
      clearInterval(keepalive);
      unsub();
      try { reply.raw.end(); } catch {}
    }

    req.raw.on("close", cleanup);
    req.raw.on("error", cleanup);

    // Don't let Fastify close the reply — we manage it
    await new Promise(() => {});
  });
}
