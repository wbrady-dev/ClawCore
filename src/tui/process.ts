import { spawn } from "child_process";

export interface StreamedCommandOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  onLine?: (line: string, source: "stdout" | "stderr") => void;
  spawnImpl?: typeof spawn;
}

export interface StreamedCommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

export async function runStreamedCommand(
  command: string,
  args: string[],
  options: StreamedCommandOptions = {},
): Promise<StreamedCommandResult> {
  return new Promise((resolve, reject) => {
    const spawnImpl = options.spawnImpl ?? spawn;
    const child = spawnImpl(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
    });

    let stdout = "";
    let stderr = "";
    let stdoutBuffer = "";
    let stderrBuffer = "";
    let settled = false;
    let timeout: NodeJS.Timeout | null = null;

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      fn();
    };

    const emitBufferedLines = (chunk: string, source: "stdout" | "stderr", carry: string): string => {
      const combined = carry + chunk;
      const parts = combined.split(/\r?\n/);
      const remainder = parts.pop() ?? "";
      for (const part of parts) {
        const clean = sanitizeCommandLine(part);
        if (clean) options.onLine?.(clean, source);
      }
      return remainder;
    };

    child.stdout?.on("data", (chunk: Buffer | string) => {
      const text = chunk.toString();
      stdout += text;
      stdoutBuffer = emitBufferedLines(text, "stdout", stdoutBuffer);
    });

    child.stderr?.on("data", (chunk: Buffer | string) => {
      const text = chunk.toString();
      stderr += text;
      stderrBuffer = emitBufferedLines(text, "stderr", stderrBuffer);
    });

    child.on("error", (error) => {
      finish(() => reject(error));
    });

    child.on("close", (code) => {
      const lastStdout = sanitizeCommandLine(stdoutBuffer);
      const lastStderr = sanitizeCommandLine(stderrBuffer);
      if (lastStdout) options.onLine?.(lastStdout, "stdout");
      if (lastStderr) options.onLine?.(lastStderr, "stderr");

      finish(() => {
        if (code === 0) {
          resolve({ code: 0, stdout, stderr });
          return;
        }
        const message = lastStderr || lastStdout || `Command failed with exit code ${code ?? "unknown"}`;
        reject(new Error(message));
      });
    });

    if (options.timeoutMs) {
      timeout = setTimeout(() => {
        try {
          child.kill();
        } catch {}
        finish(() => reject(new Error(`Command timed out after ${options.timeoutMs}ms`)));
      }, options.timeoutMs);
    }
  });
}

export function sanitizeCommandLine(line: string): string {
  return line
    .replace(/\x1b\[[0-9;]*m/g, "")
    .replace(/\r/g, "")
    .trim()
    .slice(0, 160);
}
