// .capsules/permissions.yaml (C5): roles, agents, scopes and owners, and the per-edit
// check (C5.2 step 3) that CI (M3) and the hooks (M4) share.
import picomatch from "picomatch";
import { z } from "zod";
import { readYaml, zodProblems } from "./config.js";
import { msg, type Diagnostic } from "../report/messages.js";

export const ACTIONS = [
  "read",
  "edit-code",
  "add-checks",
  "change-checks",
  "edit-context",
  "add-decisions",
  "propose-intent",
  "propose-contracts",
  "propose-examples",
  "edit-permissions",
  "edit-config",
] as const;
export type Action = (typeof ACTIONS)[number];

const PermissionsSchema = z.strictObject({
  format: z.union([z.number(), z.string()]).optional(),
  solo: z.boolean().default(false),
  humans: z
    .record(
      z.string(),
      z.strictObject({
        github: z.string().optional(),
        owns: z.array(z.string()).default([]),
        // Optional (D-017). If the repo is public, every email listed here is public too.
        emails: z.array(z.string()).default([]),
      }),
    )
    .default({}),
  roles: z.record(z.string(), z.strictObject({ may: z.array(z.enum(ACTIONS)) })).default({}),
  agents: z
    .record(
      z.string(),
      z.strictObject({
        role: z.string(),
        capsules: z.array(z.string()).default(["**"]),
        "blocked-by": z.array(z.string()).default([]),
      }),
    )
    .default({}),
});

export type Permissions = z.infer<typeof PermissionsSchema>;

/** C5 defaults, used when permissions.yaml is missing. */
export function defaultPermissions(): Permissions {
  return PermissionsSchema.parse({
    roles: {
      builder: { may: ["edit-code", "add-checks", "edit-context", "add-decisions"] },
      drafter: {
        may: [
          "edit-context",
          "add-decisions",
          "add-checks",
          "propose-intent",
          "propose-contracts",
          "propose-examples",
        ],
      },
      judge: { may: ["read"] },
    },
    agents: { default: { role: "builder", capsules: ["**"] } },
  });
}

export function parsePermissions(
  text: string | null,
  file: string,
  diagnostics: Diagnostic[],
): Permissions {
  if (text === null) return defaultPermissions();
  const raw = readYaml(text, file, diagnostics);
  if (raw === undefined) return defaultPermissions();
  const parsed = PermissionsSchema.safeParse(raw);
  if (!parsed.success) {
    diagnostics.push(msg.E022({ file, line: 1 }, zodProblems(parsed.error)));
    return defaultPermissions();
  }
  const p = parsed.data;
  for (const [name, agent] of Object.entries(p.agents)) {
    if (!p.roles[agent.role]) {
      diagnostics.push(
        msg.E022(
          { file, line: 1 },
          `agent \`${name}\` has role \`${agent.role}\`, which is not defined under \`roles\``,
        ),
      );
    }
  }
  return p;
}

/** Capsule patterns use `.` between levels (`billing.**`); match them like paths. */
export function capsuleMatches(capsuleId: string, pattern: string): boolean {
  return picomatch.isMatch(capsuleId.replace(/\./g, "/"), pattern.replace(/\./g, "/"));
}

export interface EditAnswer {
  agent: string;
  /** "code": may edit this file. "context": may only edit the capsule's context. */
  may: "code" | "context" | null;
  /** Why the agent may not edit the code, if it may not. */
  reason: string | null;
}

/** Who may edit the code of a file whose home is `home` (null = treated as root) and concerns `concerns`. */
export function whoMayEditCode(
  home: string | null,
  concerns: string[],
  perms: Permissions,
): EditAnswer[] {
  const homeId = home ?? "root";
  return (
    Object.entries(perms.agents)
      // `default` first (it's who acts without a session), then by name.
      .sort(([a], [b]) => (a === "default" ? -1 : b === "default" ? 1 : a < b ? -1 : 1))
      .map(([agent, spec]) => {
        const may = new Set(perms.roles[spec.role]?.may ?? []);
        const inScope = spec.capsules.some((p) => capsuleMatches(homeId, p));
        const blocker = concerns.find((c) => spec["blocked-by"].includes(c));
        if (may.has("edit-code") && inScope && !blocker)
          return { agent, may: "code", reason: null };
        if (!may.has("edit-code")) {
          if (may.has("edit-context") && inScope) return { agent, may: "context", reason: null };
          return {
            agent,
            may: null,
            reason: may.has("read") && may.size === 1 ? "read-only" : "role can't edit code",
          };
        }
        if (blocker) return { agent, may: null, reason: `concern: ${blocker}` };
        return { agent, may: null, reason: "outside its scope" };
      })
  );
}

export type AgentSpec = Permissions["agents"][string];

export type Verdict =
  { allowed: true; needsApproval: boolean } | { allowed: false; reason: string };

/**
 * C5.2 step 3 for an agent (or `default`): the role allows the action, the capsule is in
 * scope, and none of the file's concerns blocks the agent. `propose-*` actions are allowed
 * but need owner approval (step 4).
 */
export function agentMay(
  name: string,
  action: Action,
  capsuleId: string,
  concerns: string[],
  perms: Permissions,
): Verdict {
  const spec: AgentSpec | undefined = perms.agents[name];
  if (!spec)
    return { allowed: false, reason: `${name} is not listed under agents in permissions.yaml` };
  const may = perms.roles[spec.role]?.may ?? [];
  if (!may.includes(action))
    return { allowed: false, reason: `the ${spec.role} role of ${name} doesn't include ${action}` };
  if (!spec.capsules.some((p) => capsuleMatches(capsuleId, p)))
    return { allowed: false, reason: `${capsuleId} is outside the scope of ${name}` };
  const blocker = concerns.find((c) => spec["blocked-by"].includes(c));
  if (blocker) return { allowed: false, reason: `${name} is blocked by the ${blocker} concern` };
  return { allowed: true, needsApproval: action.startsWith("propose-") };
}
