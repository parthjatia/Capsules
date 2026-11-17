// YAML to plain values without crashing. The yaml library refuses documents that expand
// too much (an "alias bomb": a few lines that would become millions of values) by throwing
// while converting. Uncaught, that crashed capsules, and a crashing hook lets the edit
// through (hooks.on-error: open). Here it becomes a normal "can't be read" problem (M6h).
import type { Document } from "yaml";

export type YamlValue = { ok: true; value: unknown } | { ok: false; message: string };

export function toJsSafe(doc: Document): YamlValue {
  try {
    return { ok: true, value: doc.toJS() };
  } catch (e) {
    const message = e instanceof Error ? e.message.split("\n")[0]! : String(e);
    return { ok: false, message };
  }
}
