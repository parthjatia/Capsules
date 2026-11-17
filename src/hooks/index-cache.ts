// The saved index the hooks read (C11, D-010): the parsed capsules and settings, stored in
// .capsules/_cache/hook-index.json and rebuilt only when a file in .capsules/ changes.
// This module stays light: the heavy rebuild is loaded only when it's needed.
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import type { Perms } from "../core/access.js";
import type { Capsule } from "../core/model.js";
import { VERSION } from "../version.js";

export interface HookIndex {
  format: 1;
  version: string;
  /** Size and modification time of every file in .capsules/ (except _cache/). */
  stamp: string;
  config: {
    ignore: string[];
    checkFiles: string[];
    newChecksWithCode: "allow" | "block";
    onError: "open" | "closed";
    /** C18.5; an index saved before M6a has none, which means strict. */
    mode?: "strict" | "gentle";
  };
  permissions: Perms;
  capsules: Capsule[];
}

export const INDEX_FILE = ".capsules/_cache/hook-index.json";

/** The nearest folder from `start` upwards that contains `.capsules/`, stopping at the Git top level. */
export function findRoot(start: string): string | null {
  let dir = start;
  for (;;) {
    const caps = join(dir, ".capsules");
    if (existsSync(caps) && statSync(caps).isDirectory()) return dir;
    if (existsSync(join(dir, ".git"))) return null; // reached the repository's top level
    const up = dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
}

export function stampOf(root: string): string {
  const parts: string[] = [];
  const walk = (abs: string, rel: string) => {
    for (const name of readdirSync(abs).sort()) {
      if (rel === "" && name === "_cache") continue;
      const a = join(abs, name);
      const r = rel ? `${rel}/${name}` : name;
      const s = statSync(a);
      if (s.isDirectory()) walk(a, r);
      else parts.push(`${r}:${s.size}:${Math.round(s.mtimeMs)}`);
    }
  };
  walk(join(root, ".capsules"), "");
  return parts.join("|");
}

/** The saved index, rebuilt first if anything in .capsules/ changed since it was saved. */
export async function loadIndex(root: string): Promise<HookIndex> {
  const stamp = stampOf(root);
  const file = join(root, ...INDEX_FILE.split("/"));
  if (existsSync(file)) {
    try {
      const saved = JSON.parse(readFileSync(file, "utf8")) as HookIndex;
      if (saved.format === 1 && saved.version === VERSION && saved.stamp === stamp) return saved;
    } catch {
      // A damaged cache is simply rebuilt.
    }
  }
  const { buildIndex } = await import("./build-index.js");
  const index = buildIndex(root, stamp);
  try {
    mkdirSync(dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(index));
    renameSync(tmp, file);
  } catch {
    // The cache is optional; the hook still works, just more slowly next time.
  }
  return index;
}
