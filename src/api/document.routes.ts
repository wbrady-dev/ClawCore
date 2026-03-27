import type { FastifyInstance } from "fastify";
import { getMainDb } from "../storage/index.js";
import { listDocuments, deleteDocument, getCollectionByName } from "../storage/collections.js";
import { clearCache } from "../query/cache.js";
import { isLocalRequest } from "./guards.js";

const DOC_ID_RE = /^[\w\-]{1,128}$/;

export function registerDocumentRoutes(server: FastifyInstance) {
  server.get("/documents", async (req, reply) => {
    if (!isLocalRequest(req)) return reply.status(403).send({ error: "Forbidden" });
    try {
      const { collection } = req.query as { collection?: string };
      const database = getMainDb();

      let collectionId: string | undefined;
      if (collection) {
        const coll = getCollectionByName(database, collection);
        if (!coll) return reply.status(404).send({ error: `Collection '${collection}' not found` });
        collectionId = coll.id;
      }

      const documents = listDocuments(database, collectionId);
      return { documents };
    } catch (err) {
      return reply.code(500).send({ error: `Failed to list documents: ${err instanceof Error ? err.message : String(err)}` });
    }
  });

  server.delete("/documents/:id", async (req, reply) => {
    if (!isLocalRequest(req)) return reply.status(403).send({ error: "Forbidden" });

    const { id } = req.params as { id: string };

    // Validate :id parameter format
    if (!DOC_ID_RE.test(id)) {
      return reply.status(400).send({ error: "Invalid document ID format" });
    }

    try {
      const database = getMainDb();

      // Verify document exists
      const doc = database.prepare("SELECT id, source_path FROM documents WHERE id = ?").get(id) as { id: string; source_path: string } | undefined;
      if (!doc) {
        return reply.status(404).send({ error: "Document not found" });
      }

      // deleteDocument handles graph cleanup internally
      const result = deleteDocument(database, id);
      clearCache();

      return { deleted: true, chunksRemoved: result.chunksDeleted, source_path: doc.source_path };
    } catch (err) {
      return reply.code(500).send({ error: `Failed to delete document: ${err instanceof Error ? err.message : String(err)}` });
    }
  });
}
