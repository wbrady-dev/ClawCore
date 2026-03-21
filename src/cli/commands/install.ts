import { Command } from "commander";
import { detectTerminalCapabilities, setTerminalCapabilities } from "../../tui/capabilities.js";
import { runInstall } from "../../tui/screens/install.js";

export const installCommand = new Command("install")
  .description("Launch the guided ClawCore installer")
  .option("--plain", "Use the plain installer instead of the Ink UI")
  .action(async (options: { plain?: boolean }) => {
    if (options.plain) process.env.CLAWCORE_TUI_PLAIN = "true";

    const capabilities = detectTerminalCapabilities();
    setTerminalCapabilities(capabilities);

    if (capabilities.rich && !options.plain) {
      const { runInkInstall } = await import("../../tui/ink/install-actions.js");
      await runInkInstall();
      return;
    }

    await runInstall();
  });
