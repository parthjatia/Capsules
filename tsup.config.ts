import { defineConfig } from "tsup";

export default defineConfig({
  entry: { cli: "src/cli/index.ts" },
  format: ["esm"],
  target: "node22",
  platform: "node",
  outDir: "dist",
  clean: true,
  sourcemap: false,
  // Bundle everything into one file so the CLI (and later the hooks) start fast.
  noExternal: [/.*/],
  banner: {
    js: "#!/usr/bin/env node\nimport { createRequire as __capsulesCreateRequire } from 'node:module';\nconst require = __capsulesCreateRequire(import.meta.url);",
  },
});
