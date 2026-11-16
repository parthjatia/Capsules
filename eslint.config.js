import js from "@eslint/js";
import tseslint from "typescript-eslint";
import { defineConfig } from "eslint/config";

export default defineConfig(
  { ignores: ["dist/**", "node_modules/**", "coverage/**", ".capsules/_cache/**", "examples/**"] },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    files: ["scripts/**/*.mjs"],
    languageOptions: { globals: { console: "readonly", process: "readonly" } },
  },
  {
    files: ["src/**/*.ts"],
    rules: {
      // All user-facing output goes through src/report once it exists (F2).
      "no-console": "error",
    },
  },
);
