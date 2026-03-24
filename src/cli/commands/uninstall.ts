import { Command } from "commander";
import { detectTerminalCapabilities, setTerminalCapabilities } from "../../tui/capabilities.js";
import { performUninstall, runUninstall } from "../../tui/screens/uninstall.js";

export const uninstallCommand = new Command("uninstall")
  .description("Launch the guided ThreadClaw uninstaller")
  .option("--plain", "Use the plain uninstaller instead of the Ink UI")
  .option("--yes", "Skip prompts and uninstall immediately")
  .option("--delete-data", "Also delete local data when used with --yes")
  .action(async (options: { plain?: boolean; yes?: boolean; deleteData?: boolean }) => {
    if (options.yes) {
      await performUninstall({ deleteData: Boolean(options.deleteData) });
      return;
    }

    if (options.plain) process.env.THREADCLAW_TUI_PLAIN = "true";

    const capabilities = detectTerminalCapabilities();
    setTerminalCapabilities(capabilities);

    if (capabilities.rich && !options.plain) {
      const { runInkUninstall } = await import("../../tui/ink/uninstall-actions.js");
      await runInkUninstall();
      return;
    }

    await runUninstall();
  });
