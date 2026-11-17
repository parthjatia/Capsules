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
  // C18.3: a new proposal is allowed for every role but a read-only one; changing or
  // deleting an existing proposal is humans only, unless explicitly granted.
  "add-proposals",
  "edit-proposals",
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

/** Why an action was refused: only `scope` and `blocked-by` relax in gentle mode (C18.5). */
export type Refusal = "unknown-agent" | "role" | "scope" | "blocked-by";

export type Verdict =
  { allowed: true; needsApproval: boolean } | { allowed: false; reason: string; why: Refusal };

/** C18.5: in gentle mode these refusals are warnings (W111) instead of E027. */
export const gentleRelaxes = (v: Verdict, mode: string | undefined): boolean =>
  mode === "gentle" && !v.allowed && (v.why === "scope" || v.why === "blocked-by");

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
    return {
      allowed: false,
      reason: `${name} is not listed under agents in permissions.yaml`,
      why: "unknown-agent",
    };
  const may = perms.roles[spec.role]?.may ?? [];
  if (action === "add-proposals")
    return may.some((a) => a !== "read")
      ? { allowed: true, needsApproval: false }
      : { allowed: false, reason: `the ${spec.role} role of ${name} is read-only`, why: "role" };
  let effective: Action = action;
  if (action === "change-checks" && !may.includes(action) && may.includes("propose-checks"))
    effective = "propose-checks";
  if (!may.includes(effective))
    return {
      allowed: false,
      reason: `the ${spec.role} role of ${name} doesn't include ${action}`,
      why: "role",
    };
  if (!spec.capsules.some((p) => capsuleMatches(capsuleId, p)))
    return { allowed: false, reason: `${capsuleId} is outside the scope of ${name}`, why: "scope" };
  if (scope && !scope.some((p) => capsuleMatches(capsuleId, p)))
    return {
      allowed: false,
      reason: `${capsuleId} is outside this session's scope (${scope.join(", ")})`,
      why: "scope",
    };
  const blocker = concerns.find((c) => spec["blocked-by"].includes(c));
  if (blocker)
    return {
      allowed: false,
      reason: `${name} is blocked by the ${blocker} concern`,
      why: "blocked-by",
    };
  return { allowed: true, needsApproval: effective.startsWith("propose-") };
}
