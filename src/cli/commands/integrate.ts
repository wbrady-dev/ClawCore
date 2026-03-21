/**
 * clawcore integrate — manage OpenClaw integration.
 *
 * --check: read-only check for drift (default)
 * --apply: re-apply the managed integration block
 */

import { Command } from "commander";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import chalk from "chalk";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
import { checkOpenClawIntegration, applyOpenClawIntegration } from "../../integration.js";
import { readManifest, writeManifest } from "../../version.js";
import { findOpenClawConfigPath, computeIntegrationHash } from "../../integration.js";
import { readFileSync } from "fs";

export const integrateCommand = new Command("integrate")
  .description("Check or apply OpenClaw integration")
  .option("--apply", "Re-apply the managed integration block")
  .option("--check", "Check for drift without applying (default)")
  .action(async (opts: { apply?: boolean; check?: boolean }) => {
    const rootDir = resolve(__dirname, "..", "..", "..");
    const memoryEnginePath = resolve(rootDir, "memory-engine");

    if (opts.apply) {
      console.log("");
      console.log(chalk.bold("ClawCore Integration — Apply"));
      console.log("");

      const { applied, changes } = applyOpenClawIntegration(memoryEnginePath);
      if (applied) {
        for (const c of changes) {
          console.log(`  ${chalk.green("✓")} ${c}`);
        }

        // Update manifest hash
        const manifest = readManifest();
        const configPath = findOpenClawConfigPath();
        if (configPath) {
          try {
            const oc = JSON.parse(readFileSync(configPath, "utf-8"));
            manifest.integrationHash = computeIntegrationHash(oc);
            writeManifest(manifest);
          } catch (e) {
            console.warn(`  Warning: failed to update manifest hash: ${e}`);
          }
        }

        console.log("");
        console.log(chalk.green("  Integration applied."));
      } else {
        console.log(`  ${chalk.green("✓")} Integration already correct. No changes needed.`);
      }
      console.log("");
    } else {
      // Default: check
      console.log("");
      console.log(chalk.bold("ClawCore Integration — Check"));
      console.log("");

      const status = checkOpenClawIntegration(memoryEnginePath);

      if (!status.openclawFound) {
        console.log(`  ${chalk.yellow("⚠")} OpenClaw not detected`);
      } else if (status.ok) {
        console.log(`  ${chalk.green("✓")} Integration OK — all managed fields correct`);
      } else {
        console.log(`  ${chalk.red("✗")} Integration drift detected:`);
        for (const drift of status.drifts) {
          const icon = drift.severity === "error" ? chalk.red("✗") : chalk.yellow("⚠");
          console.log(`    ${icon} ${drift.field}: expected ${JSON.stringify(drift.expected)}, got ${JSON.stringify(drift.actual)}`);
        }
        console.log("");
        console.log(chalk.dim("  Run 'clawcore integrate --apply' to fix."));
      }
      console.log("");
    }
  });
