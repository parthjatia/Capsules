// `capsules hook pre-bash` (C11): best effort. Block shell commands that obviously write to
// protected paths: .capsules/ (except _cache), existing check files, generated agent files
// and CI workflows. Anything else is allowed; CI is the real gate (B13).
import { LOG_FILE, PAUSE_FILE } from "../core/activity.js";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { settingsAction } from "../core/access.js";
import { checkFileMatcher } from "../core/judges.js";
import { isGeneratedPath } from "../compile/paths.js";
import { hookMsg } from "../report/messages.js";
import { INDEX_FILE, type HookIndex } from "./index-cache.js";
import { SESSIONS_DIR } from "./session.js";
import type { HookInput, HookResult } from "./pre-edit.js";

/** Commands that change the files named in their arguments. */
const WRITERS =
  /^(rm|rmdir|unlink|mv|cp|tee|truncate|touch|ln|install|dd|chmod|shred|Remove-Item|Move-Item|Copy-Item|Set-Content|Add-Content|Out-File|Clear-Content|New-Item|ri|del|erase|move|copy)$/i;
const IN_PLACE = /^(sed|perl|gsed)$/;
const GIT_WRITERS = /^(rm|mv|checkout|restore|apply|stash|clean|reset)$/;
/** Commands that change the current folder. */
const CHANGE_DIR = /^(cd|chdir|pushd|Set-Location|sl|Push-Location)$/i;
const BACK_DIR = /^(popd|Pop-Location)$/i;

type Item = { kind: "cmd"; words: string[] } | { kind: "open" } | { kind: "close" };

/** `<<EOF`, `<<-EOF`, `<<'EOF'`, `<<"EOF"`: the delimiter, and where the command goes on. */
function heredocDelimiter(command: string, at: number): { delimiter: string; next: number } {
  let j = at;
  if (command[j] === "-") j++;
  while (command[j] === " " || command[j] === "\t") j++;
  let d = "";
  let q: string | null = null;
  for (; j < command.length; j++) {
    const c = command[j]!;
    if (q) {
      if (c === q) q = null;
      else d += c;
    } else if (c === "'" || c === '"') q = c;
    else if (/[\s;|&()<>]/.test(c)) break;
    else if (c !== "\\") d += c;
  }
  return { delimiter: d, next: j };
}

/** Skip each heredoc body in turn, from `pos`; returns where commands start again. */
function skipHeredocs(command: string, pos: number, delimiters: string[]): number {
  let p = pos;
  for (const d of delimiters) {
    for (;;) {
      if (p >= command.length) return command.length;
      const nl = command.indexOf("\n", p);
      const line = command.slice(p, nl < 0 ? command.length : nl);
      p = nl < 0 ? command.length : nl + 1;
      if (line.replace(/^\t+/, "").replace(/\r$/, "") === d) break;
    }
  }
  return p;
}

/** Split a command line into simple commands and subshell brackets, in order. */
function split(command: string): Item[] {
  const out: Item[] = [];
  let cur: string[] = [];
  let w = "";
  let quote: string | null = null;
  const heredocs: string[] = [];
  const push = () => {
    if (w !== "") cur.push(w);
    w = "";
  };
  const end = () => {
    push();
    if (cur.length) out.push({ kind: "cmd", words: cur });
    cur = [];
  };
  for (let i = 0; i < command.length; i++) {
    const ch = command[i]!;
    if (quote) {
      if (ch === quote) quote = null;
      else w += ch;
    } else if (ch === "'" || ch === '"') quote = ch;
    else if (ch === "\n") {
      end();
      // A heredoc's body is data, not commands: skip it up to its closing line.
      if (heredocs.length) i = skipHeredocs(command, i + 1, heredocs.splice(0)) - 1;
    } else if (ch === "<" && command[i + 1] === "<" && command[i + 2] !== "<") {
      push();
      const { delimiter, next } = heredocDelimiter(command, i + 2);
      if (delimiter) heredocs.push(delimiter);
      i = next - 1;
    } else if (/\s/.test(ch)) push();
    else if (ch === ";" || ch === "|" || ch === "&") end();
    else if (ch === "(" || ch === ")") {
      end();
      out.push({ kind: ch === "(" ? "open" : "close" });
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
  end();
  return out;
}

/** Split a command line into simple commands, each a list of words (quotes removed). */
export function words(command: string): string[][] {
  return split(command).flatMap((x) => (x.kind === "cmd" ? [x.words] : []));
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

/**
 * On Windows, Git Bash and MSYS write `C:\x` as `/c/x`. Turn that into a path Node
 * understands, or `/c/...` would look like a folder outside the repo.
 */
export function nativePath(p: string, platform: NodeJS.Platform = process.platform): string {
  if (platform !== "win32") return p;
  const m = /^\/([a-zA-Z])(\/.*)?$/.exec(p);
  return m ? `${m[1]!.toUpperCase()}:${m[2] ?? "/"}` : p;
}

/**
 * Every path the command writes, resolved against the folder it is in at that point:
 * `cd`, `pushd` and `popd` move it, a `( ... )` subshell gets its folder back afterwards,
 * and `NAME=value` set earlier in the command fills in `$NAME`. When a folder can't be
 * known (`cd -`, an unknown variable, backticks), paths fall back to the starting folder,
 * which is how the hook behaved before it followed `cd` (D-028).
 */
export function resolvedWrites(command: string, cwd: string): string[] {
  const vars = new Map<string, string>();
  const subshells: string[] = [];
  const pushed: string[] = [];
  let dir: string | null = cwd;
  const out: string[] = [];
  const expand = (s: string): string | null => {
    if (/`|\$\(/.test(s)) return null;
    let unknown = false;
    const v = s
      .replace(/^~(?=\/|$)/, homedir().split(sep).join("/"))
      .replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}|\$([A-Za-z_][A-Za-z0-9_]*)/g, (_m, a, b) => {
        const val = vars.get((a ?? b) as string);
        if (val === undefined) unknown = true;
        return val ?? "";
      });
    return unknown || v.includes("$") ? null : v;
  };
  const at = (p: string, base: string | null) => {
    const n = nativePath(p);
    return isAbsolute(n) ? n : resolve(base ?? cwd, n);
  };

  for (const item of split(command)) {
    if (item.kind === "open") {
      subshells.push(dir ?? "\0");
      continue;
    }
    if (item.kind === "close") {
      const back = subshells.pop();
      dir = back === undefined ? dir : back === "\0" ? null : back;
      continue;
    }
    const w = item.words;
    const name = w[0] ?? "";
    // NAME=value on its own sets a shell variable for the rest of the command.
    if (w.every((x) => /^[A-Za-z_][A-Za-z0-9_]*=/.test(x))) {
      for (const x of w) {
        const i = x.indexOf("=");
        const val = expand(x.slice(i + 1));
        if (val === null) vars.delete(x.slice(0, i));
        else vars.set(x.slice(0, i), val);
      }
      continue;
    }
    if (CHANGE_DIR.test(name)) {
      const target = w.slice(1).filter((a) => !a.startsWith("-") || a === "-")[0];
      if (/^(pushd|Push-Location)$/i.test(name)) pushed.push(dir ?? "\0");
      const t = target === undefined ? homedir() : target === "-" ? null : expand(target);
      // An absolute target is known even after an unknown `cd`; a relative one isn't.
      dir =
        t === null
          ? null
          : isAbsolute(nativePath(t))
            ? at(t, null)
            : dir === null
              ? null
              : at(t, dir);
      continue;
    }
    if (BACK_DIR.test(name)) {
      const back = pushed.pop();
      dir = back === undefined || back === "\0" ? null : back;
      continue;
    }
    for (const raw of writtenPaths(w)) {
      const p = expand(raw) ?? raw;
      out.push(at(p, dir));
    }
  }
  return out;
}

/**
 * C19: an agent must not pause the guard, rewrite what it logged, forge the hook index or
 * reset a session's one-rule memory from the shell. Compared without letter case (Windows
 * and macOS disks ignore it). The rest of _cache (the map, the last check) stays open.
 */
const GUARD_CACHE = [PAUSE_FILE, LOG_FILE, INDEX_FILE, SESSIONS_DIR].map((p) => p.toLowerCase());
const isGuardCache = (p: string): boolean => {
  const f = p.toLowerCase();
  // Deleting the whole cache stays allowed: it can be rebuilt at any time (B3).
  return GUARD_CACHE.some((g) => f === g || f.startsWith(g + "/"));
};

const CAPSULES_BIN = /(^|[\\/])(capsules(\.cmd|\.exe)?|cli\.js)["']?$/;

/** C18.4, C18.5: commands only a human may run (approving, removing proposals, setting the mode). */
export function humansOnlyCommand(command: string): string | null {
  for (const cmd of words(command)) {
    const i = cmd.findIndex((w) => CAPSULES_BIN.test(w));
    if (i < 0) continue;
    const [sub, arg] = cmd.slice(i + 1);
    if (sub === "review" && (arg === "approve" || arg === "done")) return `capsules review ${arg}`;
    if (sub === "mode" && arg !== undefined && !arg.startsWith("-")) return `capsules mode ${arg}`;
    // C19: pausing the guard and marking false alarms are a human's call too.
    if (sub === "pause" || sub === "resume") return `capsules ${sub}`;
    if (sub === "log" && cmd.some((w) => w === "--false-alarm" || w.startsWith("--false-alarm=")))
      return "capsules log --false-alarm";
  }
  return null;
}

export function preBash(input: HookInput, root: string, index: HookIndex): HookResult {
  const command = typeof input.tool_input?.command === "string" ? input.tool_input.command : "";
  const cwd = input.cwd ?? root;
  const human = humansOnlyCommand(command);
  if (human)
    return {
      kind: "block",
      reason: hookMsg.blocked(
        "E027",
        `\`${human}\` is for humans only.`,
        [["command", command.length > 120 ? command.slice(0, 117) + "..." : command]],
        hookMsg.humansOnlyWhy,
        hookMsg.humansOnlyFix,
      ),
    };
  const isCheck = checkFileMatcher(index.config.checkFiles, index.capsules);
  for (const abs of resolvedWrites(command, cwd)) {
    const rel = relative(root, abs).split(sep).join("/");
    if (rel.startsWith("..") || isAbsolute(rel)) continue;
    const p = rel.replace(/\/$/, "");
    const protectedWhy =
      p === ".capsules" || (p.startsWith(".capsules/") && !p.startsWith(".capsules/_cache"))
        ? "a capsules file"
        : isGuardCache(p)
          ? "capsules' pause switch, its log, or what it remembers about sessions"
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
