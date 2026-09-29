import { defineConfig } from "tsup";

export default defineConfig([
  {
    entry: { index: "src/index.ts" },
    format: ["cjs", "esm"],
    dts: true,
    clean: true,
    sourcemap: true,
    target: "es2022",
  },
  {
    entry: { cli: "src/cli.ts" },
    format: ["cjs", "esm"],
    dts: true,
    sourcemap: true,
    target: "es2022",
    banner: {
      js: "#!/usr/bin/env node",
    },
  },
]);
