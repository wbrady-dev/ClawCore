import pino from "pino";

// Suppress logs in CLI mode (when not running as HTTP server)
const isCli = process.argv.some(
  (a) => a.includes("clawcore.ts") || a.includes("clawcore.js"),
);

export const logger = pino({
  level: isCli ? "warn" : (process.env.LOG_LEVEL ?? "info"),
  transport:
    process.env.NODE_ENV === "production"
      ? undefined
      : { target: "pino/file", options: { destination: 1 } },
});
