// Rebuilding the hook index (heavy: parses Markdown and YAML). Loaded only when the saved
// index is out of date.
import { loadProject } from "../core/project.js";
import { VERSION } from "../version.js";
import type { HookIndex } from "./index-cache.js";

export function buildIndex(root: string, stamp: string): HookIndex {
  const p = loadProject(root);
  return {
    format: 1,
    version: VERSION,
    stamp,
    config: {
      ignore: p.config.ignore,
      checkFiles: p.config.checks.files,
      newChecksWithCode: p.config["one-rule"]["new-checks-with-code"],
      onError: p.config.hooks["on-error"],
    },
    permissions: p.permissions,
    capsules: p.capsules,
  };
}
