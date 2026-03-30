import { Command } from "commander";
import { resolve, extname, relative } from "path";
import { stat, readdir } from "fs/promises";
import { JSDOM } from "jsdom";
import { ingestFile, type IngestResult } from "../../ingest/pipeline.js";
import { getSupportedExtensions } from "../../ingest/parsers/index.js";
import { validateIngestPath } from "../../api/ingest.routes.js";
import { formatConnectionHint } from "../cli-utils.js";

export const ingestCommand = new Command("ingest")
  .description("Ingest a file, folder, or URL into the knowledge base")
  .argument("<path-or-url>", "File path, folder path, or URL to ingest")
  .option("-c, --collection <name>", "Target collection", "default")
  .option("-t, --tags <tags>", "Comma-separated tags")
  .option("-r, --recursive", "Recursively ingest folders", false)
  .option("-f, --force", "Force re-ingestion even if unchanged", false)
  .addHelpText("after", `
Examples:
  $ threadclaw ingest ./docs                                         Ingest all supported files in ./docs
  $ threadclaw ingest report.pdf --collection research               Ingest a single file into "research"
  $ threadclaw ingest ./notes -r --tags meeting,2026                 Recursively ingest with tags
  $ threadclaw ingest https://example.com --collection web-docs      Fetch and ingest a web page
  $ threadclaw ingest https://docs.site.com/llms.txt -c site-docs   Ingest a plain text URL`)
  .action(
    async (
      pathOrUrl: string,
      opts: { collection: string; tags?: string; recursive: boolean; force: boolean },
    ) => {
      try {
        const tags = opts.tags?.split(",").map((t) => t.trim()) ?? [];

        // Detect URLs
        if (pathOrUrl.startsWith("http://") || pathOrUrl.startsWith("https://")) {
          await ingestUrl(pathOrUrl, opts.collection, tags, opts.force);
          return;
        }

        const absPath = resolve(pathOrUrl);

        // Validate path safety (same check the API route uses)
        const pathErr = validateIngestPath(absPath);
        if (pathErr) {
          console.error(`Error: ${pathErr}`);
          process.exit(1);
        }

        const stats = await stat(absPath);

        if (stats.isDirectory()) {
          await ingestFolder(absPath, opts.collection, tags, opts.recursive, opts.force);
        } else {
          console.log(`Ingesting: ${absPath}`);
          console.log(`Collection: ${opts.collection}`);
          if (tags.length > 0) console.log(`Tags: ${tags.join(", ")}`);
          console.log("");

          const result = await ingestFile(absPath, {
            collection: opts.collection,
            tags,
            force: opts.force,
          });

          printResult(result);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`Error: ${msg}`);
        console.error(formatConnectionHint(msg));
        process.exit(1);
      }
    },
  );

async function ingestUrl(
  url: string,
  collection: string,
  tags: string[],
  force: boolean,
) {
  console.log(`Fetching: ${url}`);
  console.log(`Collection: ${collection}`);
  if (tags.length > 0) console.log(`Tags: ${tags.join(", ")}`);
  console.log("");

  // Fetch the URL
  const res = await fetch(url, {
    headers: { "User-Agent": "ThreadClaw/1.0 (CLI ingest)" },
    signal: AbortSignal.timeout(30_000),
    redirect: "follow",
  });

  if (!res.ok) {
    console.error(`HTTP ${res.status} ${res.statusText}`);
    process.exit(1);
  }

  const contentType = res.headers.get("content-type") ?? "";
  const rawBuffer = await res.arrayBuffer();
  const rawText = new TextDecoder().decode(rawBuffer);

  console.log(`  Downloaded: ${(rawBuffer.byteLength / 1024).toFixed(0)} KB (${contentType.split(";")[0]})`);

  // Extract text: if HTML, parse with jsdom; otherwise use raw text
  let text: string;
  if (contentType.includes("html")) {
    const dom = new JSDOM(rawText);
    const doc = dom.window.document;
    for (const el of doc.querySelectorAll("script, style, noscript")) el.remove();
    text = doc.body?.textContent ?? "";
    text = text.replace(/\s+/g, " ").trim();
    console.log(`  Extracted text: ${(text.length / 1024).toFixed(0)} KB`);
  } else {
    text = rawText.trim();
  }

  if (!text) {
    console.error("Error: No text content extracted from URL.");
    console.error("Tip: If this is a JavaScript-rendered site, try the /llms.txt or /llms-full.txt endpoint instead.");
    process.exit(1);
  }

  // Derive a title from the URL
  let title: string;
  try {
    const parsed = new URL(url);
    const pathParts = parsed.pathname.split("/").filter(Boolean);
    title = pathParts.length > 0 ? pathParts[pathParts.length - 1].replace(/\.\w+$/, "") : parsed.hostname;
  } catch {
    title = "web-ingest";
  }

  // Send to the ThreadClaw API via /ingest/text endpoint
  const { getApiBaseUrl } = await import("../../tui/platform.js");
  const apiBase = getApiBaseUrl();

  const body = JSON.stringify({
    text,
    title: title.replace(/[#\n\r]/g, ""),
    collection,
  });

  const apiRes = await fetch(`${apiBase}/ingest/text`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    signal: AbortSignal.timeout(120_000),
  });

  if (!apiRes.ok) {
    const errBody = await apiRes.text();
    console.error(`API error (${apiRes.status}): ${errBody}`);
    process.exit(1);
  }

  const result = await apiRes.json() as { ok: boolean } & IngestResult;
  printResult(result);
}

async function ingestFolder(
  dirPath: string,
  collection: string,
  tags: string[],
  recursive: boolean,
  force: boolean,
) {
  const supported = new Set(getSupportedExtensions());
  const files = await collectFiles(dirPath, supported, recursive);

  if (files.length === 0) {
    console.log(`No supported files found in ${dirPath}`);
    process.exit(1);
  }

  console.log(`Ingesting ${files.length} files from: ${dirPath}`);
  console.log(`Collection: ${collection}`);
  if (tags.length > 0) console.log(`Tags: ${tags.join(", ")}`);
  console.log("");

  let totalDocs = 0;
  let totalUpdated = 0;
  let totalChunks = 0;
  let totalSkipped = 0;
  let errors = 0;

  // Files are ingested sequentially to avoid overwhelming the embedding server.
  // TODO: Consider bounded parallelism (e.g. p-limit) for faster ingestion on capable hardware.
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const name = relative(dirPath, file);
    process.stdout.write(`  [${i + 1}/${files.length}] ${name} ... `);

    const filePathErr = validateIngestPath(file);
    if (filePathErr) {
      console.log(`BLOCKED: ${filePathErr}`);
      errors++;
      continue;
    }

    try {
      const result = await ingestFile(file, { collection, tags, force });
      if (result.duplicatesSkipped > 0) {
        console.log("unchanged");
        totalSkipped++;
      } else if (result.documentsUpdated > 0) {
        console.log(`updated (${result.chunksCreated} chunks, ${result.elapsedMs}ms)`);
        totalUpdated++;
        totalChunks += result.chunksCreated;
      } else {
        console.log(`${result.chunksCreated} chunks (${result.elapsedMs}ms)`);
        totalDocs += result.documentsAdded;
        totalChunks += result.chunksCreated;
      }
    } catch (err) {
      console.log(`ERROR: ${err instanceof Error ? err.message : err}`);
      errors++;
    }
  }

  console.log("");
  console.log(
    `Done: ${totalDocs} added, ${totalUpdated} updated, ${totalChunks} chunks, ${totalSkipped} unchanged, ${errors} errors`,
  );
}

async function collectFiles(
  dirPath: string,
  supportedExts: Set<string>,
  recursive: boolean,
): Promise<string[]> {
  const entries = await readdir(dirPath, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = resolve(dirPath, entry.name);
    if (entry.isFile()) {
      const ext = extname(entry.name).toLowerCase();
      if (supportedExts.has(ext)) {
        files.push(fullPath);
      }
    } else if (entry.isDirectory() && recursive && !entry.name.startsWith(".")) {
      const subFiles = await collectFiles(fullPath, supportedExts, true);
      files.push(...subFiles);
    }
  }

  return files.sort();
}

function printResult(result: IngestResult) {
  if (result.duplicatesSkipped > 0) {
    console.log("Unchanged (skipped).");
  } else if (result.documentsUpdated > 0) {
    console.log(`Updated: ${result.chunksCreated} chunks, ${result.elapsedMs}ms`);
  } else {
    console.log(`Ingested: ${result.documentsAdded} doc, ${result.chunksCreated} chunks, ${result.elapsedMs}ms`);
  }
}
