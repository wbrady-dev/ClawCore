import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { resolve } from "path";
import { getRootDir } from "./platform.js";
import { sanitizeCommandLine } from "./process.js";

export type ServiceLogName = "models" | "threadclaw";

export function getServiceLogPath(name: ServiceLogName, root = getRootDir()): string {
  return resolve(root, "logs", name === "models" ? "models.log" : "threadclaw.log");
}

export function clearServiceLogs(root = getRootDir()): void {
  mkdirSync(resolve(root, "logs"), { recursive: true });
  writeFileSync(getServiceLogPath("models", root), "");
  writeFileSync(getServiceLogPath("threadclaw", root), "");
}

export function readLatestServiceLogLine(name: ServiceLogName, root = getRootDir()): string {
  const logPath = getServiceLogPath(name, root);
  if (!existsSync(logPath)) return "";

  const raw = readFileSync(logPath, "utf-8");
  const lines = raw
    .split(/\r?\n/)
    .map((line) => sanitizeCommandLine(line))
    .filter(Boolean)
    // Filter out tqdm progress bars and garbled carriage-return output
    .filter((line) => !/\d+%\|[█▏▎▍▌▋▊▉ ]+\|/.test(line))
    .filter((line) => !line.includes("checkpoint shard"));

  return lines[lines.length - 1] ?? "";
}

export function readServiceLogTail(name: ServiceLogName, lines = 5, root = getRootDir()): string[] {
  const logPath = getServiceLogPath(name, root);
  if (!existsSync(logPath)) return [];

  return readFileSync(logPath, "utf-8")
    .split(/\r?\n/)
    .map((line) => sanitizeCommandLine(line))
    .filter(Boolean)
    .slice(-lines);
}
