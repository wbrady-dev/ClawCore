import { defineConfig } from "tsup";

export default defineConfig([
  {
    entry: ["src/index.ts"],
    format: ["esm"],
    outDir: "dist",
    sourcemap: true,
    clean: true,
    target: "node22",
  },
  {
    entry: ["src/cli/threadclaw.ts"],
    format: ["esm"],
    outDir: "dist/cli",
    sourcemap: true,
    target: "node22",
  },
]);
