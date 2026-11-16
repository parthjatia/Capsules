// Who may do what (C5.1, C5.2 step 3). Kept free of YAML and zod, so the fast hook entry
// point (D-010) can load it without the heavy libraries that read permissions.yaml.
import picomatch from "picomatch";

export const ACTIONS = [
  "read",
  "edit-code",
  "add-checks",
  "change-checks",
  "propose-checks",
  "edit-context",
  "add-decisions",
  "propose-intent",
  "propose-contracts",
  "propose-examples",
  "edit-permissions",
  "edit-config",
] as const;
export type Action = (typeof ACTIONS)[number];

/** Claude Code's project settings: they hold the hooks, so only humans may change them (D-026). */
export const CLAUDE_SETTINGS = [".claude/settings.json", ".claude/settings.local.json"];

/**
 * Settings files are humans-only (C5.1, C5.2): permissions.yaml is `edit-permissions`;
 * config.yaml, CI workflows and Claude Code's project settings are `edit-config`
 * (D-020, D-026). Anything else: null.
 */
export function settingsAction(path: string): "edit-config" | "edit-permissions" | null {
  if (path === ".capsules/permissions.yaml") return "edit-permissions";
  if (
    path === ".capsules/config.yaml" ||
    path.startsWith(".github/workflows/") ||
    CLAUDE_SETTINGS.includes(path)
  )
    return "edit-config";
  return null;
}

/** The parsed shape of permissions.yaml (C5). */
export interface Perms {
  solo: boolean;
  humans: Record<string, { github?: string | undefined; owns: string[]; emails: string[] }>;
  roles: Record<string, { may: Action[] }>;
  agents: Record<string, { role: string; capsules: string[]; "blocked-by": string[] }>;
}

export type Verdict =
  { allowed: true; needsApproval: boolean } | { allowed: false; reason: string };

/** Capsule patterns use `.` between levels (`billing.**`); match them like paths. */
export function capsuleMatches(capsuleId: string, pattern: string): boolean {
  return picomatch.isMatch(capsuleId.replace(/\./g, "/"), pattern.replace(/\./g, "/"));
}

/**
 * C5.2 step 3 for an agent (or `default`): the role allows the action, the capsule is in
 * scope, and none of the file's concerns blocks the agent. `propose-*` actions are allowed
 * but need owner approval (step 4). A role with `propose-checks` but not `change-checks`
 * may change existing checks with approval (D-021). `scope` narrows the agent's capsules
 * further, for a `capsules work` session (C8).
 */
export function agentMay(
  name: string,
  action: Action,
  capsuleId: string,
  concerns: string[],
  perms: Perms,
  scope?: string[],
): Verdict {
  const spec = perms.agents[name];
  if (!spec)
    return { allowed: false, reason: `${name} is not listed under agents in permissions.yaml` };
  const may = perms.roles[spec.role]?.may ?? [];
  let effective: Action = action;
  if (action === "change-checks" && !may.includes(action) && may.includes("propose-checks"))
    effective = "propose-checks";
  if (!may.includes(effective))
    return { allowed: false, reason: `the ${spec.role} role of ${name} doesn't include ${action}` };
  if (!spec.capsules.some((p) => capsuleMatches(capsuleId, p)))
    return { allowed: false, reason: `${capsuleId} is outside the scope of ${name}` };
  if (scope && !scope.some((p) => capsuleMatches(capsuleId, p)))
    return {
      allowed: false,
      reason: `${capsuleId} is outside this session's scope (${scope.join(", ")})`,
    };
  const blocker = concerns.find((c) => spec["blocked-by"].includes(c));
  if (blocker) return { allowed: false, reason: `${name} is blocked by the ${blocker} concern` };
  return { allowed: true, needsApproval: effective.startsWith("propose-") };
}
