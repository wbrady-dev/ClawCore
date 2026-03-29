import { Command } from "commander";
import { detectTerminalCapabilities, setTerminalCapabilities } from "../../tui/capabilities.js";
import { performUninstall } from "../../tui/uninstall-helpers.js";

export const uninstallCommand = new Command("uninstall")
  .description("Launch the guided ThreadClaw uninstaller")
  .option("--yes", "Skip prompts and uninstall immediately")
  .option("--delete-data", "Also delete local data when used with --yes")
  .action(async (options: { yes?: boolean; deleteData?: boolean }) => {
    try {
      if (options.deleteData && !options.yes) {
        console.warn("Warning: --delete-data only takes effect with --yes. Without --yes, the interactive uninstaller will prompt you.");
      }

      if (options.yes) {
        console.log(`Uninstalling ThreadClaw${options.deleteData ? " (including local data)" : ""}...`);
        await performUninstall({ deleteData: Boolean(options.deleteData) });
        console.log("Uninstall complete.");
        return;
      }

      const capabilities = detectTerminalCapabilities();
      setTerminalCapabilities(capabilities);

      const { runInkUninstall } = await import("../../tui/ink/uninstall-actions.js");
      await runInkUninstall();
    } catch (err) {
      console.error(`Uninstall failed: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  });
