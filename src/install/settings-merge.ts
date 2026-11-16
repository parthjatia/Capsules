// Merge our hooks into a Claude Code settings file without touching anything else, and take
// them out again (C11, D-026). Our entries are recognised by their command: `… hook <event>`
// run by a capsules CLI.

export interface HookGroup {
  matcher?: string;
  hooks: { type: string; command: string; timeout?: number }[];
}
type Settings = Record<string, unknown> & { hooks?: Record<string, HookGroup[]> };

const OURS = /(capsules|cli\.js)\S*["']?\s+hook\s+(pre-edit|pre-bash|stop)\s*$/;

export function isOurs(command: string): boolean {
  return OURS.test(command.trim());
}

/** Our hook groups, calling the CLI at `cli` (an absolute path). */
export function ourHooks(cli: string): Record<string, HookGroup[]> {
  const cmd = (event: string) => `node "${cli}" hook ${event}`;
  return {
    PreToolUse: [
      {
        matcher: "Edit|Write|MultiEdit|NotebookEdit",
        hooks: [{ type: "command", command: cmd("pre-edit"), timeout: 30 }],
      },
      { matcher: "Bash", hooks: [{ type: "command", command: cmd("pre-bash"), timeout: 30 }] },
    ],
    Stop: [{ hooks: [{ type: "command", command: cmd("stop"), timeout: 60 }] }],
  };
}

export class SettingsError extends Error {}

function parse(text: string | null, path: string): Settings {
  if (text === null || !text.trim()) return {};
  try {
    const v: unknown = JSON.parse(text);
    if (v && typeof v === "object" && !Array.isArray(v)) return v as Settings;
  } catch {
    // reported below
  }
  throw new SettingsError(
    `${path} is not valid JSON, so capsules won't change it.\n  fix: repair the file (Claude Code reports the error with /status), then run capsules init again.`,
  );
}

/** Remove our groups from parsed settings; drops `hooks` (or an event) left empty. */
function strip(s: Settings): Settings {
  if (!s.hooks || typeof s.hooks !== "object") return s;
  const hooks: Record<string, HookGroup[]> = {};
  for (const [event, groups] of Object.entries(s.hooks)) {
    if (!Array.isArray(groups)) {
      hooks[event] = groups;
      continue;
    }
    const kept = groups
      .map((g) => ({ ...g, hooks: (g.hooks ?? []).filter((h) => !isOurs(h.command ?? "")) }))
      .filter((g, i) => g.hooks.length > 0 || (groups[i]!.hooks ?? []).length === 0);
    if (kept.length) hooks[event] = kept;
  }
  const out: Settings = { ...s };
  if (Object.keys(hooks).length) out.hooks = hooks;
  else delete out.hooks;
  return out;
}

/** The settings text with our hooks added (any older copy of ours replaced). */
export function mergeHooks(text: string | null, path: string, cli: string): string {
  const s = strip(parse(text, path));
  const hooks: Record<string, HookGroup[]> = { ...(s.hooks ?? {}) };
  for (const [event, groups] of Object.entries(ourHooks(cli)))
    hooks[event] = [...(hooks[event] ?? []), ...groups];
  return JSON.stringify({ ...s, hooks }, null, 2) + "\n";
}

/**
 * The settings text with our hooks taken out. If what's left equals the file before we
 * merged, that exact text comes back (byte for byte). `null` means: delete the file.
 */
export function unmergeHooks(text: string, path: string, before: string | null): string | null {
  const s = strip(parse(text, path));
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  if (before !== null) {
    try {
      if (same(s, JSON.parse(before))) return before;
    } catch {
      // `before` wasn't JSON: fall through and write what's left
    }
  } else if (Object.keys(s).length === 0) return null;
  return JSON.stringify(s, null, 2) + "\n";
}

export function hasOurHooks(text: string | null): boolean {
  try {
    const s = parse(text, "");
    return Object.values(s.hooks ?? {}).some(
      (groups) =>
        Array.isArray(groups) &&
        groups.some((g) => (g.hooks ?? []).some((h) => isOurs(h.command ?? ""))),
    );
  } catch {
    return false;
  }
}
