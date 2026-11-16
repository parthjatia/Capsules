// Who made a change, and who owns a capsule (C5.3, D-017).
import { ancestorsOf, type Capsule } from "./model.js";
import { capsuleMatches, type Permissions } from "./permissions.js";

export type Actor =
  | { kind: "agent"; name: string }
  | { kind: "human"; name: string }
  | { kind: "unknown"; email: string | null };

/** Values of a trailer, matching the key case-insensitively. */
export function trailer(trailers: Map<string, string[]>, key: string): string[] {
  const out: string[] = [];
  for (const [k, v] of trailers) if (k.toLowerCase() === key.toLowerCase()) out.push(...v);
  return out;
}

const NOREPLY = /^(?:\d+\+)?([A-Za-z0-9-]+)@users\.noreply\.github\.com$/i;

/** C5.3 steps 1 to 3: map an author email to a human in permissions.yaml. */
export function humanFromEmail(email: string | null, perms: Permissions): Actor {
  if (!email) return { kind: "unknown", email: null };
  const noreply = NOREPLY.exec(email);
  if (noreply) {
    const human = humanFromGithub(noreply[1]!, perms);
    if (human.kind === "human") return human;
  }
  const lower = email.toLowerCase();
  for (const [name, h] of Object.entries(perms.humans))
    if (h.emails.some((e) => e.toLowerCase() === lower)) return { kind: "human", name };
  return { kind: "unknown", email };
}

/** The human whose `github` handle is `login` (case-insensitive). */
export function humanFromGithub(login: string | null, perms: Permissions): Actor {
  if (login) {
    for (const [name, h] of Object.entries(perms.humans))
      if (h.github?.toLowerCase() === login.toLowerCase()) return { kind: "human", name };
  }
  return { kind: "unknown", email: null };
}

/** The actor of a commit: its `Capsule-Agent` trailer, else the human author (C5.3). */
export function actorOf(
  trailers: Map<string, string[]>,
  email: string | null,
  perms: Permissions,
): Actor {
  const agent = trailer(trailers, "Capsule-Agent")[0];
  if (agent) return { kind: "agent", name: agent };
  return humanFromEmail(email, perms);
}

export function actorLabel(a: Actor): string {
  if (a.kind === "agent") return `agent ${a.name}`;
  if (a.kind === "human") return a.name;
  return a.email
    ? `${a.email} (not in permissions.yaml, so acts as default)`
    : "an unknown author (acts as default)";
}

/** Owners from the capsule's front matter, or its nearest ancestor's; concerns fall back to root. */
export function ownersOf(capsules: Capsule[], capsuleId: string): string[] {
  const byId = new Map(capsules.map((c) => [c.id, c]));
  const chain =
    byId.get(capsuleId)?.kind === "concern"
      ? [capsuleId, "root"]
      : [capsuleId, ...ancestorsOf(capsuleId)];
  for (const id of chain) {
    const owners = byId.get(id)?.front?.owners;
    if (owners) return owners;
  }
  return [];
}

/** C5.3: an owner is in the capsule's owners, or has an `owns` pattern matching it. */
export function isOwner(
  human: string,
  capsuleId: string,
  capsules: Capsule[],
  perms: Permissions,
): boolean {
  if (ownersOf(capsules, capsuleId).includes(human)) return true;
  return (perms.humans[human]?.owns ?? []).some((p) => capsuleMatches(capsuleId, p));
}
