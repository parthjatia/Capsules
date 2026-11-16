// `capsules hook pre-bash` (C11): best effort. Block shell commands that obviously write to
// protected paths: .capsules/ (except _cache), existing check files, generated agent files
// and CI workflows. Anything else is allowed; CI is the real gate (B13).
import { existsSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { settingsAction } from "../core/access.js";
import { checkFileMatcher } from "../core/judges.js";
import { isGeneratedPath } from "../compile/paths.js";
import { hookMsg } from "../report/messages.js";
import type { HookIndex } from "./index-cache.js";
import type { HookInput, HookResult } from "./pre-edit.js";

/** Commands that change the files named in their arguments. */
const WRITERS =
  /^(rm|rmdir|unlink|mv|cp|tee|truncate|touch|ln|install|dd|chmod|shred|Remove-Item|Move-Item|Copy-Item|Set-Content|Add-Content|Out-File|Clear-Content|New-Item|ri|del|erase|move|copy)$/i;
const IN_PLACE = /^(sed|perl|gsed)$/;
const GIT_WRITERS = /^(rm|mv|checkout|restore|apply|stash|clean|reset)$/;

/** Split a command line into simple commands, each a list of words (quotes removed). */
export function words(command: string): string[][] {
  const out: string[][] = [];
  let cur: string[] = [];
  let w = "";
  let quote: string | null = null;
  const push = () => {
    if (w !== "") cur.push(w);
    w = "";
  };
  for (let i = 0; i < command.length; i++) {
    const ch = command[i]!;
    if (quote) {
      if (ch === quote) quote = null;
      else w += ch;
    } else if (ch === "'" || ch === '"') quote = ch;
    else if (/\s/.test(ch)) push();
    else if (ch === ";" || ch === "|" || ch === "&" || ch === "\n" || ch === "(" || ch === ")") {
      push();
      if (cur.length) out.push(cur);
      cur = [];
    } else if (ch === ">") {
      if (/^\d+$/.test(w)) w = ""; // the file descriptor in 2>file is not a word
      push();
      if (command[i + 1] === ">") i++;
      if (command[i + 1] === "&") {
        // 2>&1 and >&2 redirect to another descriptor, not a file.
        i++;
        while (/[\d-]/.test(command[i + 1] ?? "")) i++;
        continue;
      }
      cur.push(">");
    } else w += ch;
  }
  push();
  if (cur.length) out.push(cur);
  return out;
}

/** The paths a simple command (obviously) writes to. */
export function writtenPaths(cmd: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < cmd.length; i++) if (cmd[i] === ">" && cmd[i + 1]) out.push(cmd[i + 1]!);
  const args = cmd.filter((w, i) => w !== ">" && cmd[i - 1] !== ">");
  // Skip leading env assignments and sudo/env wrappers.
  let k = 0;
  while (
    k < args.length &&
    (/^[A-Za-z_][A-Za-z0-9_]*=/.test(args[k]!) || args[k] === "sudo" || args[k] === "env")
  )
    k++;
  const name = (args[k] ?? "").replace(/^.*[\\/]/, "");
  const rest = args.slice(k + 1).filter((a) => !a.startsWith("-"));
  if (WRITERS.test(name))
    out.push(...(name === "cp" || name === "copy" || name === "Copy-Item" ? rest.slice(-1) : rest));
  else if (
    IN_PLACE.test(name) &&
    args.slice(k + 1).some((a) => /^-[a-zA-Z]*i/.test(a) || a.startsWith("--in-place"))
  )
    out.push(...rest.slice(1));
  else if (name === "git" && GIT_WRITERS.test(args[k + 1] ?? "")) out.push(...rest.slice(1));
  return out;
}

export function preBash(input: HookInput, root: string, index: HookIndex): HookResult {
  const command = typeof input.tool_input?.command === "string" ? input.tool_input.command : "";
  const cwd = input.cwd ?? root;
  const isCheck = checkFileMatcher(index.config.checkFiles, index.capsules);
  for (const cmd of words(command))
    for (const raw of writtenPaths(cmd)) {
      const abs = isAbsolute(raw) ? raw : resolve(cwd, raw);
      const rel = relative(root, abs).split(sep).join("/");
      if (rel.startsWith("..") || isAbsolute(rel)) continue;
      const p = rel.replace(/\/$/, "");
      const protectedWhy =
        p === ".capsules" || (p.startsWith(".capsules/") && !p.startsWith(".capsules/_cache"))
          ? "a capsules file"
          : p.startsWith(".github/workflows")
            ? "a CI workflow"
            : p === ".claude" || settingsAction(p)
              ? "Claude Code's settings, which hold the hooks"
              : isGeneratedPath(p)
                ? "a generated agent file"
                : isCheck(p) && existsSync(abs)
                  ? "an existing check"
                  : null;
      if (protectedWhy)
        return {
          kind: "block",
          reason: hookMsg.blocked(
            "E027",
            `this shell command would change ${protectedWhy}.`,
            [
              ["file", p],
              ["command", command.length > 120 ? command.slice(0, 117) + "..." : command],
            ],
            hookMsg.bashWhy,
            hookMsg.bashFix,
          ),
        };
    }
  return { kind: "allow" };
}
