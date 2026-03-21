import { execFileSync } from "child_process";
import { existsSync, readFileSync, statSync } from "fs";
import { resolve } from "path";
import { homedir } from "os";
import { section, status, kvLine, t, clearScreen } from "../theme.js";
import { checkServices, readConfig, getRootDir, getDataDir, getPlatform, findOpenClaw, getApiPort, getModelPort, getApiBaseUrl, getModelBaseUrl } from "../platform.js";
import { detectGpu } from "../models.js";
import { selectMenu } from "../menu.js";

export async function showStatus(): Promise<void> {
  clearScreen();

  const svc = checkServices();
  const config = readConfig();
  const root = getRootDir();
  const gpu = detectGpu();

  // ── Services ──
  console.log(section("Services"));
  console.log(status("Models", svc.models.running, `port ${getModelPort()}`));
  console.log(status("ClawCore RAG API", svc.clawcore.running, `port ${getApiPort()}`));

  // Auto-startup
  let autoStart = false;
  if (getPlatform() === "windows") {
    try {
      const out = execFileSync("sc", ["query", "ClawCoreModels"], { stdio: "pipe" }).toString();
      autoStart = !out.includes("does not exist");
    } catch {}
  }
  console.log(status("Auto-Startup", autoStart));

  // Game mode
  const gameModeOn = !svc.models.running && !svc.clawcore.running;
  console.log(kvLine("Game Mode", gameModeOn ? t.warn("on (VRAM freed)") : t.dim("off")));

  // ── Models ──
  console.log(section("Models"));

  let embedOk = false;
  let rerankOk = false;
  let doclingOk = false;
  let doclingDevice = "off";

  try {
    const res = await fetch(`${getModelBaseUrl()}/health`, { signal: AbortSignal.timeout(3000) });
    const data = (await res.json()) as any;
    embedOk = data.models?.embed?.ready === true;
    rerankOk = data.models?.rerank?.ready === true;
    doclingOk = data.models?.docling?.ready === true;
    doclingDevice = data.models?.docling?.device ?? "off";
  } catch {}

  const embedName = config?.embed_model ?? "not configured";
  const rerankName = config?.rerank_model ?? "not configured";

  console.log(`  ${embedOk ? t.ok("●") : t.err("●")} ${t.label("Embed")}   ${t.value(embedName)}`);
  console.log(`  ${rerankOk ? t.ok("●") : t.err("●")} ${t.label("Rerank")}  ${t.value(rerankName)}`);
  console.log(`  ${doclingOk ? t.ok("●") : t.dim("●")} ${t.label("Docling")} ${doclingOk ? t.value(config?.docling_device ?? "cpu") : t.dim("off")}`);

  // Query expansion
  let expansionLabel = t.dim("off");
  try {
    const envPath = resolve(root, ".env");
    if (existsSync(envPath)) {
      const env = readFileSync(envPath, "utf-8");
      const enabled = env.match(/QUERY_EXPANSION_ENABLED=(\w+)/)?.[1];
      const model = env.match(/QUERY_EXPANSION_MODEL=(.+)/)?.[1]?.trim();
      if (enabled === "true" && model) expansionLabel = t.value(model);
    }
  } catch {}
  console.log(`  ${t.dim("●")} ${t.label("Query Expansion")} ${expansionLabel}`);

  // ── GPU ──
  console.log(section("GPU"));
  if (gpu.detected) {
    const usedPct = Math.round((gpu.vramUsedMb / gpu.vramTotalMb) * 100);
    const vramColor = usedPct >= 80 ? t.err : usedPct >= 50 ? t.warn : t.ok;
    console.log(kvLine("GPU", gpu.name));
    console.log(kvLine("VRAM", vramColor(`${gpu.vramUsedMb} / ${gpu.vramTotalMb} MB (${usedPct}%)`)));
    console.log(kvLine("Free", `${gpu.vramFreeMb} MB`));
  } else {
    console.log(kvLine("GPU", t.err("not detected")));
  }

  // ── File Watcher ──
  let watchCount = 0;
  let watchPaths: string[] = [];
  try {
    const envPath = resolve(root, ".env");
    if (existsSync(envPath)) {
      const env = readFileSync(envPath, "utf-8");
      const raw = env.match(/WATCH_PATHS=(.+)/)?.[1]?.trim();
      if (raw) {
        const entries = raw.split(",").filter(Boolean);
        watchCount = entries.length;
        watchPaths = entries.map((e) => {
          const pipeIdx = e.lastIndexOf("|");
          const path = pipeIdx > 0 ? e.slice(0, pipeIdx) : e;
          const coll = pipeIdx > 0 ? e.slice(pipeIdx + 1) : "default";
          const parts = path.replace(/\\/g, "/").split("/");
          const short = parts.length > 3 ? "..." + parts.slice(-2).join("/") : path;
          return `${short} ${t.dim(`→ ${coll}`)}`;
        });
      }
    }
  } catch {}

  console.log(section("File Watcher"));
  if (watchCount > 0) {
    console.log(kvLine("Status", t.ok(`${watchCount} paths active`)));
    for (const wp of watchPaths) {
      console.log(`    ${t.dim("•")} ${wp}`);
    }
  } else {
    console.log(kvLine("Status", t.dim("not configured")));
  }

  // ── Database ──
  const dbPath = resolve(getDataDir(), "clawcore.db");
  console.log(section("Database"));
  if (existsSync(dbPath)) {
    const size = statSync(dbPath).size;
    console.log(kvLine("Size", `${(size / 1024 / 1024).toFixed(2)} MB`));

    try {
      const res = await fetch(`${getApiBaseUrl()}/stats`, { signal: AbortSignal.timeout(3000) });
      const stats = (await res.json()) as any;
      console.log(kvLine("Collections", String(stats.collections)));
      console.log(kvLine("Documents", String(stats.documents)));
      console.log(kvLine("Chunks", String(stats.chunks)));
      console.log(kvLine("Tokens", stats.tokens?.toLocaleString() ?? "0"));
    } catch {
      console.log(t.dim("  API not responding — start services to see stats."));
    }
  } else {
    console.log(t.dim("  No database yet. Ingest documents to create one."));
  }

  // ── Collections ──
  try {
    const res = await fetch(`${getApiBaseUrl()}/collections`, { signal: AbortSignal.timeout(3000) });
    const data = (await res.json()) as any;
    if (data.collections?.length > 0) {
      console.log(section("Collections"));
      for (const c of data.collections) {
        console.log(`    ${t.selected(c.name.padEnd(20))} ${t.dim(c.id.slice(0, 8) + "...")}`);
      }
    }
  } catch {}

  // ── Network ──
  console.log(section("Network"));
  try {
    const envPath = resolve(root, ".env");
    if (existsSync(envPath)) {
      const env = readFileSync(envPath, "utf-8");
      console.log(kvLine("ClawCore API", getApiBaseUrl()));
      console.log(kvLine("Model Server", getModelBaseUrl()));
    }
  } catch {}

  // ── Evidence OS ──
  const graphDbPath = resolve(homedir(), ".clawcore", "data", "graph.db");
  console.log(section("Evidence OS"));

  // Check config
  let evidenceEnabled = false;
  let awarenessEnabled = false;
  try {
    const envPath = resolve(getRootDir(), ".env");
    if (existsSync(envPath)) {
      const env = readFileSync(envPath, "utf-8");
      evidenceEnabled = env.includes("CLAWCORE_MEMORY_RELATIONS_ENABLED=true");
      awarenessEnabled = env.includes("CLAWCORE_MEMORY_RELATIONS_AWARENESS_ENABLED=true");
    }
  } catch {}

  console.log(kvLine("Relations", evidenceEnabled ? t.ok("enabled") : t.dim("disabled")));
  console.log(kvLine("Awareness", awarenessEnabled ? t.ok("enabled") : t.dim("disabled")));

  if (existsSync(graphDbPath)) {
    const graphSize = statSync(graphDbPath).size;
    console.log(kvLine("Graph DB", `${(graphSize / 1024 / 1024).toFixed(2)} MB`));

    // Try to read basic stats from graph DB (handle missing tables gracefully)
    try {
      const { getGraphDb } = await import("../../storage/graph-sqlite.js");
      const graphDb = getGraphDb(graphDbPath);

      const safeCount = (sql: string): number => {
        try { return (graphDb.prepare(sql).get() as { cnt: number }).cnt; } catch { return -1; }
      };

      const entities = safeCount("SELECT COUNT(*) as cnt FROM entities");
      const mentions = safeCount("SELECT COUNT(*) as cnt FROM entity_mentions");
      const claims = safeCount("SELECT COUNT(*) as cnt FROM claims WHERE status = 'active'");
      const decisions = safeCount("SELECT COUNT(*) as cnt FROM decisions WHERE status = 'active'");
      const loops = safeCount("SELECT COUNT(*) as cnt FROM open_loops WHERE status IN ('open','blocked')");
      const events = safeCount("SELECT COUNT(*) as cnt FROM evidence_log");

      if (entities >= 0) console.log(kvLine("Entities", String(entities)));
      if (mentions >= 0) console.log(kvLine("Mentions", String(mentions)));
      if (claims > 0) console.log(kvLine("Claims", String(claims)));
      if (decisions > 0) console.log(kvLine("Decisions", String(decisions)));
      if (loops > 0) console.log(kvLine("Open Loops", String(loops)));
      if (events >= 0) console.log(kvLine("Evidence Events", events.toLocaleString()));

      if (entities < 0 && events < 0) {
        console.log(t.dim("  (graph DB exists but schema not fully migrated — run 'clawcore upgrade')"));
      }
    } catch {
      console.log(t.dim("  (unable to read graph DB)"));
    }
  } else {
    console.log(kvLine("Graph DB", t.dim("not created yet")));
  }

  // OpenClaw
  const ocDir = findOpenClaw();
  if (ocDir) {
    console.log(kvLine("OpenClaw", t.ok(`detected at ${ocDir}`)));
  }

  console.log("");

  await selectMenu([{ label: "Back", value: "back", color: t.dim }]);
}
