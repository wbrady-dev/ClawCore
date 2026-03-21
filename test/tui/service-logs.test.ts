import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { clearServiceLogs, getServiceLogPath, readLatestServiceLogLine, readServiceLogTail } from "../../src/tui/service-logs.ts";

test("service log helpers clear and read log files", () => {
  const root = mkdtempSync(join(tmpdir(), "clawcore-tui-"));

  clearServiceLogs(root);
  assert.equal(readLatestServiceLogLine("models", root), "");

  const modelsLog = getServiceLogPath("models", root);
  writeFileSync(modelsLog, "booting\nmodel loaded\n");

  assert.equal(readLatestServiceLogLine("models", root), "model loaded");
  assert.deepEqual(readServiceLogTail("models", 2, root), ["booting", "model loaded"]);
});
