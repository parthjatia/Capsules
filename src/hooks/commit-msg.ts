// `capsules hook commit-msg <file>` (C8): add the current work session's trailers and any
// pending `Capsule-Cosmetic` lines to a commit message. Installed as a Git hook only with
// `capsules init --git-hooks` (D-023).
import { readFileSync, writeFileSync } from "node:fs";
import { activeWorkSession, takePendingCosmetic } from "./session.js";

export function addTrailers(message: string, lines: string[]): string {
  const text = message.replace(/\r\n?/g, "\n");
  // Comment lines (git's template) stay at the end, after the trailers.
  const all = text.split("\n");
  let cut = all.length;
  while (cut > 0 && (all[cut - 1]!.startsWith("#") || all[cut - 1]!.trim() === "")) cut--;
  const body = all.slice(0, cut);
  const tail = all.slice(cut).filter((l) => l.startsWith("#"));
  const present = new Set(body.map((l) => l.trim()));
  const add = lines.filter((l) => !present.has(l));
  if (!add.length || !body.some((l) => l.trim() && !l.startsWith("#"))) return message;
  const last = body.slice(body.lastIndexOf("") + 1);
  const inTrailerBlock =
    body.lastIndexOf("") > 0 &&
    last.length > 0 &&
    last.every((l) => /^[A-Za-z][A-Za-z0-9-]*: /.test(l));
  const out = [...body, ...(inTrailerBlock ? [] : [""]), ...add];
  return out.join("\n") + "\n" + (tail.length ? "\n" + tail.join("\n") + "\n" : "");
}

export function commitMsg(root: string, file: string, env = process.env): void {
  const lines: string[] = [];
  const s = activeWorkSession(root, env);
  if (s)
    lines.push(
      `Capsule-Session: ${s.id}`,
      `Capsule-Agent: ${s.agent}`,
      `Capsule-Role: ${s.role}`,
      `Capsule-Scope: ${s.capsules.join(", ")}`,
    );
  for (const a of takePendingCosmetic(root)) lines.push(`Capsule-Cosmetic: ${a}`);
  if (!lines.length) return;
  const before = readFileSync(file, "utf8");
  const after = addTrailers(before, lines);
  if (after !== before) writeFileSync(file, after);
}
