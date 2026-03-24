import { Command } from "commander";
import { t } from "../../tui/theme.js";
import { performServiceAction } from "../../tui/service-actions.js";

export const stopCommand = new Command("stop")
  .description("Stop ThreadClaw services")
  .action(async () => {
    console.log(t.brand("\n  THREADCLAW STOP\n"));
    try {
      const result = await performServiceAction("stop", {
        onStatus: (status) => {
          console.log(`  ${status}`);
        },
      });
      if (!result.success) {
        console.error(t.err(`\n  Failed to stop: ${result.message}\n`));
        process.exit(1);
      }
      console.log(t.ok("\n  Services stopped successfully.\n"));
    } catch (err: any) {
      console.error(t.err(`\n  Failed to stop: ${err.message}\n`));
      process.exit(1);
    }
  });
