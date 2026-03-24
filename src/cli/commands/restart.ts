import { Command } from "commander";
import { t } from "../../tui/theme.js";
import { performServiceAction } from "../../tui/service-actions.js";

export const restartCommand = new Command("restart")
  .description("Restart ThreadClaw services")
  .action(async () => {
    console.log(t.brand("\n  THREADCLAW RESTART\n"));
    try {
      const result = await performServiceAction("restart", {
        onStatus: (status) => {
          console.log(`  ${status}`);
        },
      });
      if (!result.success) {
        console.error(t.err(`\n  Failed to restart: ${result.message}\n`));
        process.exit(1);
      }
      console.log(t.ok("\n  Services restarted successfully.\n"));
    } catch (err: any) {
      console.error(t.err(`\n  Failed to restart: ${err.message}\n`));
      process.exit(1);
    }
  });
