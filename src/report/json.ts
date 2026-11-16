import { FORMAT_VERSION } from "../version.js";

/** Every --json output carries the versioned schema marker (C15). Keys keep insertion order. */
export function toJson(kind: string, body: Record<string, unknown>): string {
  return JSON.stringify({ format: FORMAT_VERSION, kind, ...body }, null, 2) + "\n";
}
