/**
 * TUI Sources Screen — unified view of all knowledge sources.
 */
import prompts from "prompts";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { resolve } from "path";
import { section, kvLine, t, clearScreen } from "../theme.js";
import { selectMenu } from "../menu.js";
import { getRootDir, getApiBaseUrl } from "../platform.js";
import { getSourceEntries } from "../../sources/registry.js";
import { detectObsidianVaults } from "../../sources/adapters/obsidian.js";
import { hasGDriveCredentials, runGDriveOAuth, removeGDriveCredentials, listDriveFolders } from "../../sources/adapters/gdrive.js";
import { detectOneDriveFolder, hasOneDriveCredentials, runOneDriveOAuth, removeOneDriveCredentials, listOneDriveFolders } from "../../sources/adapters/onedrive.js";
import { hasNotionApiKey, listNotionDatabases } from "../../sources/adapters/notion.js";
import { listNotesFolders } from "../../sources/adapters/apple-notes.js";

function stateIcon(state: string): string {
  switch (state) {
    case "watching":
      return t.ok("●");
    case "syncing":
      return t.ok("◉");
    case "idle":
      return t.dim("●");
    case "error":
      return t.err("●");
    case "disabled":
      return t.dim("○");
    case "unavailable":
      return t.dim("○");
    default:
      return t.dim("●");
  }
}

function stateLabel(state: string): string {
  switch (state) {
    case "watching":
      return t.ok("watching (real-time)");
    case "syncing":
      return t.ok("syncing");
    case "idle":
      return t.dim("idle");
    case "error":
      return t.err("error");
    case "disabled":
      return t.dim("disabled");
    case "unavailable":
      return t.dim("not available");
    default:
      return t.dim(state);
  }
}

/** Get doc counts per collection from the API */
async function getCollectionStats(): Promise<Map<string, number>> {
  const stats = new Map<string, number>();
  try {
    const res = await fetch(`${getApiBaseUrl()}/collections`, {
      signal: AbortSignal.timeout(3000),
    });
    const data = (await res.json()) as any;
    if (data.collections) {
      for (const c of data.collections) {
        stats.set(c.name, c.documentCount ?? c.documents ?? 0);
      }
    }
  } catch {}
  return stats;
}

/** Fetch live source status from the running server API */
async function getLiveSourceStatus(): Promise<any[]> {
  try {
    const res = await fetch(`${getApiBaseUrl()}/sources`, {
      signal: AbortSignal.timeout(3000),
    });
    if (res.ok) {
      const data = (await res.json()) as any;
      return data.sources ?? [];
    }
  } catch {}
  return [];
}

function formatAge(date: string | undefined): string {
  if (!date) return "";
  const ms = Date.now() - new Date(date).getTime();
  if (ms < 60_000) return `${Math.round(ms / 1000)}s ago`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m ago`;
  return `${Math.round(ms / 3_600_000)}h ago`;
}

export async function showSources(): Promise<void> {
  while (true) {
    clearScreen();
    console.log(section("Knowledge Sources"));
    console.log(
      t.dim("  All indexing runs locally — zero cloud tokens.\n"),
    );

    // Try live API first, fall back to registry
    const liveSources = await getLiveSourceStatus();
    const entries = getSourceEntries();
    const collStats = await getCollectionStats();

    let totalDocs = 0;
    let activeCount = 0;

    for (const entry of entries) {
      const { adapter, config: cfg } = entry;

      // Use live status from API if available
      const live = liveSources.find((s: any) => s.id === adapter.id);
      const liveStatus = live?.status;

      // Determine effective state
      let effectiveState = liveStatus?.state ?? entry.status.state;
      if (!cfg.enabled && (effectiveState === "idle" || effectiveState === "watching")) effectiveState = "disabled";

      // Count docs from collections
      let docCount = 0;
      const collNames: string[] = [];
      const colls2use = live?.collections ?? cfg.collections;
      for (const c of colls2use) {
        const collName = c.collection;
        const count = collStats.get(collName) ?? 0;
        docCount += count;
        collNames.push(collName);
      }
      totalDocs += docCount;
      if (cfg.enabled) activeCount++;

      // Build status with sync info
      let statusText = stateLabel(effectiveState);
      if (liveStatus?.lastSync) {
        statusText += t.dim(` · synced ${formatAge(liveStatus.lastSync)}`);
      }

      const icon = stateIcon(effectiveState);
      const docsLabel = docCount > 0 ? t.value(`${docCount} docs`) : "";

      // Source name line
      console.log(`  ${icon} ${t.label(adapter.name)}  ${statusText}  ${docsLabel}`);

      // Collection details (indented)
      if (collNames.length > 0) {
        for (const cn of collNames) {
          const cnt = collStats.get(cn) ?? 0;
          const cntLabel = cnt > 0 ? t.dim(`(${cnt})`) : "";
          console.log(`      ${t.dim("→")} ${t.dim(cn)} ${cntLabel}`);
        }
      }

      // Show error detail
      const error = liveStatus?.error ?? entry.status.error;
      if (error) {
        console.log(`      ${t.err(error)}`);
      }

      console.log(""); // spacing between sources
    }

    console.log(t.dim("  " + "─".repeat(60)));
    console.log(
      `  ${t.value(String(totalDocs))} documents  ${t.dim("·")}  ${t.value(String(activeCount))} active sources  ${t.dim("·")}  ${t.ok("0 cloud tokens")}`,
    );

    console.log("");

    // Menu
    const menuItems = [
      { label: "Refresh", value: "refresh", description: "Reload status" },
      {
        label: "Configure Obsidian",
        value: "obsidian",
        description: "Add or change Obsidian vault",
      },
      {
        label: "Configure Google Drive",
        value: "gdrive",
        description: "Add or change Drive folders",
      },
      {
        label: "Configure OneDrive",
        value: "onedrive",
        description: "Local sync folder or cloud API",
      },
      {
        label: "Configure Notion",
        value: "notion",
        description: "Add or change Notion databases",
      },
      ...(process.platform === "darwin"
        ? [{ label: "Configure Apple Notes", value: "apple-notes", description: "Add or change Notes folders" }]
        : []),
      { label: "Back", value: "back", color: t.dim },
    ];

    const action = await selectMenu(menuItems);

    if (!action || action === "back") break;
    if (action === "refresh") continue;

    if (action === "obsidian") {
      await configureObsidian();
    } else if (action === "gdrive") {
      await configureGDrive();
    } else if (action === "onedrive") {
      await configureOneDrive();
    } else if (action === "notion") {
      await configureNotion();
    } else if (action === "apple-notes") {
      await configureAppleNotes();
    }
  }
}

export async function configureObsidian(): Promise<void> {
  clearScreen();
  console.log(section("Obsidian Vault"));

  const root = getRootDir();
  const envPath = resolve(root, ".env");
  let env = readEnv(envPath);

  const currentEnabled = envGet(env, "OBSIDIAN_ENABLED") === "true";
  const currentPath = envGet(env, "OBSIDIAN_VAULT_PATH") || undefined;

  // Show current state
  if (currentPath) {
    console.log(kvLine("Current vault", currentPath));
    console.log(
      kvLine("Status", currentEnabled ? t.ok("enabled") : t.dim("disabled")),
    );
  } else {
    console.log(t.dim("  No vault configured.\n"));
  }

  // Detect vaults
  const detected = detectObsidianVaults();
  if (detected.length > 0) {
    console.log(t.dim("\n  Detected vaults:"));
    for (const v of detected) {
      const isCurrent = v === currentPath;
      console.log(
        `    ${isCurrent ? t.ok("●") : t.dim("●")} ${v}${isCurrent ? t.ok(" (current)") : ""}`,
      );
    }
  } else {
    console.log(t.dim("\n  No vaults auto-detected."));
  }

  console.log("");

  // Build menu
  const items: { label: string; value: string; color?: (s: string) => string }[] =
    [];

  // Option to select each detected vault
  for (const v of detected) {
    const short = v.replace(/\\/g, "/").split("/").pop() ?? v;
    items.push({
      label: `Use vault: ${short}`,
      value: `set:${v}`,
    });
  }

  if (currentPath && currentEnabled) {
    items.push({ label: "Disable Ingestion", value: "disable" });
  } else if (currentPath) {
    items.push({ label: "Enable Ingestion", value: "enable" });
  }

  items.push({ label: "Back", value: "back", color: t.dim });

  const action = await selectMenu(items);

  if (!action || action === "back") return;

  if (action === "disable") {
    env = updateEnvVarStr(env, "OBSIDIAN_ENABLED", "false");
    writeFileSync(envPath, env, "utf-8");
    console.log(t.ok("\n  Obsidian disabled. Changes saved.\n"));
    await pressAnyKey();
    return;
  }

  if (action === "enable") {
    env = updateEnvVarStr(env, "OBSIDIAN_ENABLED", "true");
    writeFileSync(envPath, env, "utf-8");
    addObsidianToWatchPaths(envPath, currentPath!);
    console.log(t.ok("\n  Obsidian enabled."));
    await triggerReload();
    await pressAnyKey();
    return;
  }

  if (action.startsWith("set:")) {
    const vaultPath = action.slice(4);
    let updated = env;
    updated = updateEnvVarStr(updated, "OBSIDIAN_ENABLED", "true");
    updated = updateEnvVarStr(updated, "OBSIDIAN_VAULT_PATH", vaultPath);
    updated = updateEnvVarStr(updated, "OBSIDIAN_COLLECTION", "obsidian");
    writeFileSync(envPath, updated, "utf-8");

    // Add to WATCH_PATHS
    addObsidianToWatchPaths(envPath, vaultPath);

    console.log(t.ok(`\n  Obsidian vault set to: ${vaultPath}`));
    await triggerReload();
    await pressAnyKey();
  }
}

function readEnv(envPath: string): string {
  try {
    if (existsSync(envPath)) return readFileSync(envPath, "utf-8");
  } catch {}
  return "";
}

/** Escape regex metacharacters in a string for safe use in new RegExp(). */
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function envGet(env: string, key: string): string {
  return env.match(new RegExp(`^${escapeRegex(key)}=(.*)`, "m"))?.[1]?.trim() ?? "";
}

function updateEnvVarStr(env: string, key: string, value: string): string {
  const pattern = new RegExp(`^${escapeRegex(key)}=.*`, "m");
  if (pattern.test(env)) {
    return env.replace(pattern, `${key}=${value}`);
  }
  return env.trimEnd() + `\n${key}=${value}\n`;
}

function addObsidianToWatchPaths(envPath: string, vaultPath: string): void {
  let env = "";
  try {
    env = readFileSync(envPath, "utf-8");
  } catch {
    return;
  }

  const watchMatch = env.match(/^WATCH_PATHS=(.*)$/m);
  const current = watchMatch?.[1]?.trim() ?? "";
  const entry = `${vaultPath}|obsidian`;

  // Check if already present
  if (current.includes(vaultPath)) return;

  const newPaths = current ? `${current},${entry}` : entry;
  const updated = updateEnvVarStr(env, "WATCH_PATHS", newPaths);
  writeFileSync(envPath, updated, "utf-8");
}

export async function configureGDrive(): Promise<void> {
  clearScreen();
  console.log(section("Google Drive"));

  const root = getRootDir();
  const envPath = resolve(root, ".env");
  let env = readEnv(envPath);

  const currentEnabled = envGet(env, "GDRIVE_ENABLED") === "true";
  const currentFolders = envGet(env, "GDRIVE_FOLDERS");
  const currentInterval = envGet(env, "GDRIVE_SYNC_INTERVAL") || "300";
  const hasCredentials = hasGDriveCredentials();
  const clientId = envGet(env, "GDRIVE_CLIENT_ID");
  const clientSecret = envGet(env, "GDRIVE_CLIENT_SECRET");

  // Status
  console.log(kvLine("Auth", hasCredentials ? t.ok("connected") : t.dim("not connected")));
  console.log(kvLine("Ingestion", currentEnabled ? t.ok("enabled") : t.dim("disabled")));
  if (currentFolders) {
    console.log(kvLine("Sync interval", `${currentInterval}s`));
    // Show folders
    const folders = currentFolders.split(",").map((f) => f.trim()).filter(Boolean);
    for (const f of folders) {
      const [name, coll] = f.split("|");
      console.log(`    ${t.dim("•")} ${name} ${t.dim("→")} ${coll ?? "gdrive"}`);
    }
  }

  if (!clientId) {
    console.log(t.dim("\n  Setup:"));
    console.log(t.dim("  1. console.cloud.google.com > APIs > Credentials"));
    console.log(t.dim("  2. Create OAuth 2.0 Client ID (Desktop app)"));
    console.log(t.dim("  3. Enable the Google Drive API"));
    console.log(t.dim("  4. Add GDRIVE_CLIENT_ID and GDRIVE_CLIENT_SECRET to .env"));
    console.log(t.dim(`  5. Redirect URI: http://localhost:18801/oauth2callback\n`));
  }

  console.log("");

  // Menu
  const items: { label: string; value: string; color?: (s: string) => string; description?: string }[] = [];

  if (clientId && clientSecret && !hasCredentials) {
    items.push({ label: "Connect Google Account", value: "auth", description: "Opens browser for sign-in" });
  }

  if (hasCredentials) {
    if (currentEnabled) {
      items.push({ label: "Disable Ingestion", value: "disable", description: "Stop syncing, keep connection" });
    } else {
      items.push({ label: "Enable Ingestion", value: "enable", description: "Start syncing Drive folders" });
    }
    items.push({ label: "Add Folder", value: "add-folder", description: "Add a Drive folder to sync" });
    if (currentFolders) {
      items.push({ label: "Remove Folder", value: "remove-folder" });
      items.push({ label: "Change Sync Interval", value: "interval" });
    }
    items.push({ label: "Disconnect Google Account", value: "disconnect" });
  }

  items.push({ label: "Back", value: "back", color: t.dim });
  const action = await selectMenu(items);
  if (!action || action === "back") return;

  // Re-read env in case it changed
  env = readEnv(envPath);

  if (action === "auth" && clientId && clientSecret) {
    const success = await runGDriveOAuth(clientId, clientSecret);
    console.log(success ? t.ok("\n  Connected!") : t.err("\n  Authentication failed."));
    await pressAnyKey();
  } else if (action === "enable") {
    if (!currentFolders) {
      console.log(t.dim("\n  Add a folder first.\n"));
      const folder = await promptFolder();
      if (folder) {
        env = updateEnvVarStr(env, "GDRIVE_FOLDERS", folder);
        env = updateEnvVarStr(env, "GDRIVE_ENABLED", "true");
        writeFileSync(envPath, env, "utf-8");
        console.log(t.ok("  Ingestion enabled."));
        await triggerReload();
      }
    } else {
      env = updateEnvVarStr(env, "GDRIVE_ENABLED", "true");
      writeFileSync(envPath, env, "utf-8");
      console.log(t.ok("\n  Ingestion enabled."));
      await triggerReload();
    }
    await pressAnyKey();
  } else if (action === "disable") {
    env = updateEnvVarStr(env, "GDRIVE_ENABLED", "false");
    writeFileSync(envPath, env, "utf-8");
    console.log(t.ok("\n  Ingestion disabled. Connection preserved."));
    await pressAnyKey();
  } else if (action === "add-folder") {
    const folder = await promptFolder();
    if (folder) {
      const existing = envGet(env, "GDRIVE_FOLDERS");
      const newFolders = existing ? `${existing},${folder}` : folder;
      env = updateEnvVarStr(env, "GDRIVE_FOLDERS", newFolders);
      env = updateEnvVarStr(env, "GDRIVE_ENABLED", "true");
      writeFileSync(envPath, env, "utf-8");
      console.log(t.ok(`  Added.`));
      await triggerReload();
    }
    await pressAnyKey();
  } else if (action === "remove-folder") {
    const folders = (currentFolders ?? "").split(",").map((f) => f.trim()).filter(Boolean);
    const removeItems = folders.map((f) => {
      const [name, coll] = f.split("|");
      return { label: `${name} → ${coll}`, value: f };
    });
    removeItems.push({ label: "Cancel", value: "cancel", color: t.dim } as any);
    const toRemove = await selectMenu(removeItems);
    if (toRemove && toRemove !== "cancel") {
      const remaining = folders.filter((f) => f !== toRemove).join(",");
      env = updateEnvVarStr(env, "GDRIVE_FOLDERS", remaining);
      if (!remaining) env = updateEnvVarStr(env, "GDRIVE_ENABLED", "false");
      writeFileSync(envPath, env, "utf-8");
      console.log(t.ok("  Removed."));
    }
    await pressAnyKey();
  } else if (action === "interval") {
    let cancelled = false;
    const { interval } = await prompts({ type: "text", name: "interval", message: "Sync interval (seconds)", initial: currentInterval }, { onCancel: () => { cancelled = true; } });
    if (!cancelled && interval) {
      env = updateEnvVarStr(env, "GDRIVE_SYNC_INTERVAL", interval);
      writeFileSync(envPath, env, "utf-8");
      console.log(t.ok(`  Interval set to ${interval}s.`));
    }
    await pressAnyKey();
  } else if (action === "disconnect") {
    removeGDriveCredentials();
    env = updateEnvVarStr(env, "GDRIVE_ENABLED", "false");
    writeFileSync(envPath, env, "utf-8");
    console.log(t.ok("\n  Disconnected."));
    await pressAnyKey();
  }
}

async function promptFolder(): Promise<string | null> {
  console.log(t.dim("\n  Loading Drive folders...\n"));

  const folders = await listDriveFolders();

  if (folders.length === 0) {
    console.log(t.dim("  No folders found in Drive root. You can type a name manually."));
    let cancelled = false;
    const onCancel = () => { cancelled = true; };
    const { name } = await prompts({ type: "text", name: "name", message: "Drive folder name (exact)" }, { onCancel });
    if (cancelled || !name) return null;
    const defaultColl = "gdrive-" + name.toLowerCase().replace(/\s+/g, "-");
    const { coll } = await prompts({ type: "text", name: "coll", message: "Collection name", initial: defaultColl }, { onCancel });
    if (cancelled || !coll) return null;
    return `${name}|${coll}`;
  }

  // Show folders as selectable menu
  const folderItems = folders.map((f) => ({
    label: f.name,
    value: f.name,
  }));
  folderItems.push({ label: "Type manually", value: "__manual__" });
  folderItems.push({ label: "Cancel", value: "__cancel__", color: t.dim } as any);

  console.log(t.dim(`  ${folders.length} folders found in Drive:\n`));
  const picked = await selectMenu(folderItems);
  if (!picked || picked === "__cancel__") return null;

  let folderName: string;
  if (picked === "__manual__") {
    let cancelled = false;
    const { name } = await prompts({ type: "text", name: "name", message: "Drive folder name (exact)" }, { onCancel: () => { cancelled = true; } });
    if (cancelled || !name) return null;
    folderName = name;
  } else {
    folderName = picked;
  }

  const defaultColl = "gdrive-" + folderName.toLowerCase().replace(/\s+/g, "-");
  let cancelled = false;
  const { coll } = await prompts({ type: "text", name: "coll", message: "Collection name", initial: defaultColl }, { onCancel: () => { cancelled = true; } });
  if (cancelled || !coll) return null;

  return `${folderName}|${coll}`;
}

// ── OneDrive ──

export async function configureOneDrive(): Promise<void> {
  const root = getRootDir();
  const envPath = resolve(root, ".env");
  let env = "";
  try { env = readFileSync(envPath, "utf-8"); } catch {}

  const envGet = (e: string, key: string) => e.match(new RegExp(`${escapeRegex(key)}=(.*)`))?.[1]?.trim() ?? "";
  const envSet = (e: string, key: string, val: string) => {
    const re = new RegExp(`^${escapeRegex(key)}=.*$`, "m");
    if (re.test(e)) return e.replace(re, `${key}=${val}`);
    return e.trimEnd() + `\n${key}=${val}\n`;
  };

  clearScreen();
  console.log(section("Microsoft OneDrive"));
  console.log("");

  const currentEnabled = envGet(env, "ONEDRIVE_ENABLED") === "true";
  const localPath = envGet(env, "ONEDRIVE_LOCAL_PATH");
  const detectedFolder = detectOneDriveFolder();
  const hasCloud = hasOneDriveCredentials();

  console.log(t.dim("  Two ways to connect OneDrive:\n"));
  console.log(t.dim("  1. Local sync folder — uses your OneDrive desktop app folder"));
  console.log(t.dim("     No API key needed. Files are already on your machine.\n"));
  console.log(t.dim("  2. Cloud API — syncs files directly from OneDrive cloud"));
  console.log(t.dim("     Requires Azure AD app registration (free).\n"));

  if (detectedFolder) {
    console.log(`  ${t.ok("✓")} OneDrive folder detected: ${detectedFolder}`);
  } else {
    console.log(`  ${t.dim("·")} No local OneDrive folder detected`);
  }
  if (hasCloud) {
    console.log(`  ${t.ok("✓")} Cloud API: connected`);
  }
  if (localPath) {
    console.log(`  ${t.dim("·")} Configured path: ${localPath}`);
  }
  console.log(`  ${t.dim("·")} Status: ${currentEnabled ? t.ok("enabled") : t.dim("disabled")}\n`);

  const action = await selectMenu([
    ...(detectedFolder ? [{ label: `Use local folder: ${detectedFolder}`, value: "local-auto" }] : []),
    { label: "Set custom local folder path", value: "local-custom" },
    { label: "Connect via cloud API (Azure AD)", value: "cloud" },
    ...(currentEnabled ? [{ label: "Disable OneDrive", value: "disable" }] : []),
    ...(hasCloud ? [{ label: "Disconnect cloud API", value: "disconnect" }] : []),
    { label: "Back", value: "back", color: t.dim },
  ]);

  if (!action || action === "back") return;

  if (action === "local-auto" && detectedFolder) {
    env = envSet(env, "ONEDRIVE_ENABLED", "true");
    env = envSet(env, "ONEDRIVE_LOCAL_PATH", detectedFolder);
    // Add to watch paths
    const watchPaths = envGet(env, "WATCH_PATHS");
    if (!watchPaths.includes(detectedFolder)) {
      const newWatch = watchPaths ? `${watchPaths},${detectedFolder}|onedrive` : `${detectedFolder}|onedrive`;
      env = envSet(env, "WATCH_PATHS", newWatch);
    }
    writeFileSync(envPath, env);
    console.log(t.ok(`\n  OneDrive enabled (local folder). Changes take effect immediately.\n`));
    await new Promise((r) => setTimeout(r, 1500));
  } else if (action === "local-custom") {
    const { customPath } = await prompts({
      type: "text",
      name: "customPath",
      message: "OneDrive folder path",
      initial: detectedFolder ?? "",
    });
    if (customPath && existsSync(customPath)) {
      env = envSet(env, "ONEDRIVE_ENABLED", "true");
      env = envSet(env, "ONEDRIVE_LOCAL_PATH", customPath);
      const watchPaths = envGet(env, "WATCH_PATHS");
      if (!watchPaths.includes(customPath)) {
        const newWatch = watchPaths ? `${watchPaths},${customPath}|onedrive` : `${customPath}|onedrive`;
        env = envSet(env, "WATCH_PATHS", newWatch);
      }
      writeFileSync(envPath, env);
      console.log(t.ok(`\n  OneDrive enabled (local folder). Changes take effect immediately.\n`));
    } else {
      console.log(t.warn("\n  Path not found. OneDrive not configured.\n"));
    }
    await new Promise((r) => setTimeout(r, 1500));
  } else if (action === "cloud") {
    const clientId = envGet(env, "ONEDRIVE_CLIENT_ID");
    const clientSecret = envGet(env, "ONEDRIVE_CLIENT_SECRET");

    if (!clientId || !clientSecret) {
      console.log("");
      console.log(t.label("  Azure AD app setup:\n"));
      console.log(t.dim("  1. Go to portal.azure.com > App registrations > New registration"));
      console.log(t.dim("  2. Name: ThreadClaw, Accounts: Personal + org"));
      console.log(t.dim("  3. Redirect URI: Web → http://localhost:18802/oauth2callback"));
      console.log(t.dim("  4. Certificates & secrets > New client secret"));
      console.log(t.dim("  5. API permissions > Add > Microsoft Graph > Files.Read.All\n"));

      const { id } = await prompts({ type: "text", name: "id", message: "Client ID" });
      const { secret } = await prompts({ type: "text", name: "secret", message: "Client Secret" });

      if (id && secret) {
        env = envSet(env, "ONEDRIVE_CLIENT_ID", id.trim());
        env = envSet(env, "ONEDRIVE_CLIENT_SECRET", secret.trim());
        writeFileSync(envPath, env);
      } else {
        console.log(t.warn("\n  Missing credentials. OneDrive cloud not configured.\n"));
        await new Promise((r) => setTimeout(r, 1500));
        return;
      }
    }

    console.log(t.dim("\n  Opening browser for OneDrive authorization...\n"));
    const success = await runOneDriveOAuth(
      envGet(env, "ONEDRIVE_CLIENT_ID") || clientId,
      envGet(env, "ONEDRIVE_CLIENT_SECRET") || clientSecret,
    );

    if (success) {
      env = envSet(env, "ONEDRIVE_ENABLED", "true");
      writeFileSync(envPath, env);
      console.log(t.ok("\n  OneDrive cloud connected and enabled!\n"));
    } else {
      console.log(t.warn("\n  Authorization failed or timed out.\n"));
    }
    await new Promise((r) => setTimeout(r, 1500));
  } else if (action === "disable") {
    env = envSet(env, "ONEDRIVE_ENABLED", "false");
    writeFileSync(envPath, env);
    console.log(t.ok("\n  OneDrive disabled.\n"));
    await new Promise((r) => setTimeout(r, 1500));
  } else if (action === "disconnect") {
    removeOneDriveCredentials();
    env = envSet(env, "ONEDRIVE_ENABLED", "false");
    writeFileSync(envPath, env);
    console.log(t.ok("\n  OneDrive cloud disconnected and disabled.\n"));
    await new Promise((r) => setTimeout(r, 1500));
  }
}

// ── Notion ──

export async function configureNotion(): Promise<void> {
  clearScreen();
  console.log(section("Notion"));

  const root = getRootDir();
  const envPath = resolve(root, ".env");
  let env = readEnv(envPath);

  const currentEnabled = envGet(env, "NOTION_ENABLED") === "true";
  const currentDbs = envGet(env, "NOTION_DATABASES");
  const hasKey = hasNotionApiKey();

  // Status
  console.log(kvLine("API Key", hasKey ? t.ok("connected") : t.dim("not set")));
  console.log(kvLine("Ingestion", currentEnabled ? t.ok("enabled") : t.dim("disabled")));
  if (currentDbs) {
    const dbs = currentDbs.split(",").map((d) => d.trim()).filter(Boolean);
    for (const d of dbs) {
      const [id, coll] = d.split("|");
      const shortId = id.length > 12 ? id.slice(0, 8) + "..." : id;
      console.log(`    ${t.dim("•")} ${shortId} ${t.dim("→")} ${coll ?? "notion"}`);
    }
  }

  if (!hasKey) {
    console.log(t.dim("\n  Setup:"));
    console.log(t.dim("  1. Create an integration at notion.so/my-integrations"));
    console.log(t.dim("  2. Copy the Internal Integration Token"));
    console.log(t.dim("  3. Set NOTION_API_KEY in your environment"));
    console.log(t.dim("  4. Share your databases with the integration in Notion\n"));
    await pressAnyKey();
    return;
  }

  console.log("");

  // Menu
  const items: { label: string; value: string; color?: (s: string) => string; description?: string }[] = [];

  if (currentEnabled) {
    items.push({ label: "Disable Ingestion", value: "disable", description: "Stop syncing, keep API key" });
  } else {
    items.push({ label: "Enable Ingestion", value: "enable", description: "Start syncing Notion databases" });
  }
  items.push({ label: "Add Database", value: "add-db", description: "Add a Notion database to sync" });
  if (currentDbs) {
    items.push({ label: "Remove Database", value: "remove-db" });
  }
  items.push({ label: "Back", value: "back", color: t.dim });

  const action = await selectMenu(items);
  if (!action || action === "back") return;

  env = readEnv(envPath);

  if (action === "enable") {
    if (!currentDbs) {
      console.log(t.dim("\n  Add a database first.\n"));
      const db = await promptNotionDb();
      if (db) {
        env = updateEnvVarStr(env, "NOTION_DATABASES", db);
        env = updateEnvVarStr(env, "NOTION_ENABLED", "true");
        writeFileSync(envPath, env, "utf-8");
        console.log(t.ok("  Ingestion enabled."));
        await triggerReload();
      }
    } else {
      env = updateEnvVarStr(env, "NOTION_ENABLED", "true");
      writeFileSync(envPath, env, "utf-8");
      console.log(t.ok("\n  Ingestion enabled."));
      await triggerReload();
    }
    await pressAnyKey();
  } else if (action === "disable") {
    env = updateEnvVarStr(env, "NOTION_ENABLED", "false");
    writeFileSync(envPath, env, "utf-8");
    console.log(t.ok("\n  Ingestion disabled. API key preserved."));
    await triggerReload();
    await pressAnyKey();
  } else if (action === "add-db") {
    const db = await promptNotionDb();
    if (db) {
      const existing = envGet(env, "NOTION_DATABASES");
      const newDbs = existing ? `${existing},${db}` : db;
      env = updateEnvVarStr(env, "NOTION_DATABASES", newDbs);
      env = updateEnvVarStr(env, "NOTION_ENABLED", "true");
      writeFileSync(envPath, env, "utf-8");
      console.log(t.ok("  Added."));
      await triggerReload();
    }
    await pressAnyKey();
  } else if (action === "remove-db") {
    const dbs = (currentDbs ?? "").split(",").map((d) => d.trim()).filter(Boolean);
    const removeItems = dbs.map((d) => {
      const [id, coll] = d.split("|");
      return { label: `${id.slice(0, 12)}... → ${coll}`, value: d };
    });
    removeItems.push({ label: "Cancel", value: "cancel", color: t.dim } as any);
    const toRemove = await selectMenu(removeItems);
    if (toRemove && toRemove !== "cancel") {
      const remaining = dbs.filter((d) => d !== toRemove).join(",");
      env = updateEnvVarStr(env, "NOTION_DATABASES", remaining);
      if (!remaining) env = updateEnvVarStr(env, "NOTION_ENABLED", "false");
      writeFileSync(envPath, env, "utf-8");
      console.log(t.ok("  Removed. Changes saved."));
    }
    await pressAnyKey();
  }
}

async function promptNotionDb(): Promise<string | null> {
  console.log(t.dim("\n  Loading Notion databases...\n"));

  const databases = await listNotionDatabases();

  if (databases.length === 0) {
    console.log(t.dim("  No databases found. Make sure you've shared databases with your integration."));
    console.log(t.dim("  You can paste a database ID manually.\n"));
    let cancelled = false;
    const onCancel = () => { cancelled = true; };
    const { id } = await prompts({ type: "text", name: "id", message: "Database ID" }, { onCancel });
    if (cancelled || !id) return null;
    const defaultColl = "notion-" + id.slice(0, 8);
    const { coll } = await prompts({ type: "text", name: "coll", message: "Collection name", initial: defaultColl }, { onCancel });
    if (cancelled || !coll) return null;
    return `${id}|${coll}`;
  }

  // Show databases as selectable menu
  const dbItems = databases.map((db) => ({
    label: `${db.title}`,
    value: db.id,
    description: db.id.slice(0, 12) + "...",
  }));
  dbItems.push({ label: "Paste ID manually", value: "__manual__", description: "" });
  dbItems.push({ label: "Cancel", value: "__cancel__", description: "", color: t.dim } as any);

  console.log(t.dim(`  ${databases.length} databases found:\n`));
  const picked = await selectMenu(dbItems);
  if (!picked || picked === "__cancel__") return null;

  let dbId: string;
  let dbName: string;
  if (picked === "__manual__") {
    let cancelled = false;
    const { id } = await prompts({ type: "text", name: "id", message: "Database ID" }, { onCancel: () => { cancelled = true; } });
    if (cancelled || !id) return null;
    dbId = id;
    dbName = id.slice(0, 8);
  } else {
    dbId = picked;
    dbName = databases.find((d) => d.id === picked)?.title ?? picked.slice(0, 8);
  }

  const defaultColl = "notion-" + dbName.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
  let cancelled = false;
  const { coll } = await prompts({ type: "text", name: "coll", message: "Collection name", initial: defaultColl }, { onCancel: () => { cancelled = true; } });
  if (cancelled || !coll) return null;

  return `${dbId}|${coll}`;
}

export async function configureAppleNotes(): Promise<void> {
  clearScreen();
  console.log(section("Apple Notes"));

  if (process.platform !== "darwin") {
    console.log(t.dim("  Apple Notes is only available on macOS.\n"));
    await pressAnyKey();
    return;
  }

  const root = getRootDir();
  const envPath = resolve(root, ".env");
  let env = readEnv(envPath);

  const currentEnabled = envGet(env, "APPLE_NOTES_ENABLED") === "true";
  const currentFolders = envGet(env, "APPLE_NOTES_FOLDERS");

  // Status
  console.log(kvLine("Ingestion", currentEnabled ? t.ok("enabled") : t.dim("disabled")));
  if (currentFolders) {
    const folders = currentFolders.split(",").map((f) => f.trim()).filter(Boolean);
    for (const f of folders) {
      const [name, coll] = f.split("|");
      console.log(`    ${t.dim("•")} ${name} ${t.dim("→")} ${coll ?? "notes"}`);
    }
  }

  console.log("");

  // Menu
  const items: { label: string; value: string; color?: (s: string) => string; description?: string }[] = [];

  if (currentEnabled) {
    items.push({ label: "Disable Ingestion", value: "disable" });
  } else {
    items.push({ label: "Enable Ingestion", value: "enable" });
  }
  items.push({ label: "Add Folder", value: "add-folder", description: "Browse Notes folders" });
  if (currentFolders) {
    items.push({ label: "Remove Folder", value: "remove-folder" });
  }
  items.push({ label: "Back", value: "back", color: t.dim });

  const action = await selectMenu(items);
  if (!action || action === "back") return;

  env = readEnv(envPath);

  if (action === "enable") {
    if (!currentFolders) {
      console.log(t.dim("\n  Add a folder first.\n"));
      const folder = await promptNotesFolder();
      if (folder) {
        env = updateEnvVarStr(env, "APPLE_NOTES_FOLDERS", folder);
        env = updateEnvVarStr(env, "APPLE_NOTES_ENABLED", "true");
        writeFileSync(envPath, env, "utf-8");
        console.log(t.ok("  Ingestion enabled."));
        await triggerReload();
      }
    } else {
      env = updateEnvVarStr(env, "APPLE_NOTES_ENABLED", "true");
      writeFileSync(envPath, env, "utf-8");
      console.log(t.ok("\n  Ingestion enabled."));
      await triggerReload();
    }
    await pressAnyKey();
  } else if (action === "disable") {
    env = updateEnvVarStr(env, "APPLE_NOTES_ENABLED", "false");
    writeFileSync(envPath, env, "utf-8");
    console.log(t.ok("\n  Ingestion disabled."));
    await triggerReload();
    await pressAnyKey();
  } else if (action === "add-folder") {
    const folder = await promptNotesFolder();
    if (folder) {
      const existing = envGet(env, "APPLE_NOTES_FOLDERS");
      const newFolders = existing ? `${existing},${folder}` : folder;
      env = updateEnvVarStr(env, "APPLE_NOTES_FOLDERS", newFolders);
      env = updateEnvVarStr(env, "APPLE_NOTES_ENABLED", "true");
      writeFileSync(envPath, env, "utf-8");
      console.log(t.ok("  Added."));
      await triggerReload();
    }
    await pressAnyKey();
  } else if (action === "remove-folder") {
    const folders = (currentFolders ?? "").split(",").map((f) => f.trim()).filter(Boolean);
    const removeItems = folders.map((f) => {
      const [name, coll] = f.split("|");
      return { label: `${name} → ${coll}`, value: f };
    });
    removeItems.push({ label: "Cancel", value: "cancel", color: t.dim } as any);
    const toRemove = await selectMenu(removeItems);
    if (toRemove && toRemove !== "cancel") {
      const remaining = folders.filter((f) => f !== toRemove).join(",");
      env = updateEnvVarStr(env, "APPLE_NOTES_FOLDERS", remaining);
      if (!remaining) env = updateEnvVarStr(env, "APPLE_NOTES_ENABLED", "false");
      writeFileSync(envPath, env, "utf-8");
      console.log(t.ok("  Removed."));
      await triggerReload();
    }
    await pressAnyKey();
  }
}

async function promptNotesFolder(): Promise<string | null> {
  console.log(t.dim("\n  Loading Notes folders...\n"));

  const folders = listNotesFolders();

  if (folders.length === 0) {
    console.log(t.dim("  No folders found."));
    let cancelled = false;
    const onCancel = () => { cancelled = true; };
    const { name } = await prompts({ type: "text", name: "name", message: "Folder name" }, { onCancel });
    if (cancelled || !name) return null;
    const defaultColl = "notes-" + name.toLowerCase().replace(/\s+/g, "-");
    const { coll } = await prompts({ type: "text", name: "coll", message: "Collection name", initial: defaultColl }, { onCancel });
    if (cancelled || !coll) return null;
    return `${name}|${coll}`;
  }

  const folderItems = folders.map((f) => ({
    label: `${f.name} (${f.count} notes)`,
    value: f.name,
  }));
  folderItems.push({ label: "Type manually", value: "__manual__" });
  folderItems.push({ label: "Cancel", value: "__cancel__", color: t.dim } as any);

  console.log(t.dim(`  ${folders.length} folders found:\n`));
  const picked = await selectMenu(folderItems);
  if (!picked || picked === "__cancel__") return null;

  let folderName: string;
  if (picked === "__manual__") {
    let cancelled = false;
    const { name } = await prompts({ type: "text", name: "name", message: "Folder name" }, { onCancel: () => { cancelled = true; } });
    if (cancelled || !name) return null;
    folderName = name;
  } else {
    folderName = picked;
  }

  const defaultColl = "notes-" + folderName.toLowerCase().replace(/\s+/g, "-");
  let cancelled = false;
  const { coll } = await prompts({ type: "text", name: "coll", message: "Collection name", initial: defaultColl }, { onCancel: () => { cancelled = true; } });
  if (cancelled || !coll) return null;

  return `${folderName}|${coll}`;
}

/** Notify the running ThreadClaw server to reload source config */
async function triggerReload(): Promise<void> {
  try {
    const res = await fetch(`${getApiBaseUrl()}/sources/reload`, {
      method: "POST",
      signal: AbortSignal.timeout(5000),
    });
    if (res.ok) {
      console.log(t.ok("  Config reloaded — no restart needed."));
    } else {
      console.log(t.dim("  Changes saved changes."));
    }
  } catch {
    console.log(t.dim("  ThreadClaw not running. Changes will apply on next start."));
  }
}

function pressAnyKey(): Promise<void> {
  return new Promise((resolve) => {
    console.log(t.dim("  Press any key to continue..."));
    if (process.stdin.isTTY) process.stdin.setRawMode(true);
    process.stdin.resume();
    const handler = () => {
      process.stdin.removeListener("data", handler);
      if (process.stdin.isTTY) process.stdin.setRawMode(false);
      process.stdin.pause();
      resolve();
    };
    process.stdin.on("data", handler);
  });
}
