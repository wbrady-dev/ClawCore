import test from "node:test";
import assert from "node:assert/strict";
import { runStreamedCommand, sanitizeCommandLine } from "../../src/tui/process.ts";

test("sanitizeCommandLine strips ANSI and trims text", () => {
  const input = "\u001b[32m  hello world  \u001b[0m";
  assert.equal(sanitizeCommandLine(input), "hello world");
});

test("runStreamedCommand captures output and emits streamed lines", async () => {
  const streamed: string[] = [];
  const result = await runStreamedCommand(
    process.execPath,
    ["-e", "console.log('ready'); console.error('warning');"],
    {
      onLine: (line) => streamed.push(line),
      timeoutMs: 5000,
    },
  );

  assert.equal(result.code, 0);
  assert.match(result.stdout, /ready/);
  assert.match(result.stderr, /warning/);
  assert.deepEqual(streamed, ["ready", "warning"]);
});
