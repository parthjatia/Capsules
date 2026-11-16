// Address grammar (B7, C2.2): `capsule#node`, refs `@node` / `@capsule#node`.
// `repo:capsule#node` is reserved for cross-repo links and rejected in v0.1 (E015, D-001).

const SEG = "[a-z0-9-]+";
export const CAPSULE_ID_RE = new RegExp(`^${SEG}(?:\\.${SEG})*$`);
export const NODE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9-]*$/;
const REPO_RE = new RegExp(`^${SEG}$`);

export type ParsedAddress =
  | { ok: true; capsule: string | null; node: string }
  | { ok: false; reason: "cross-repo"; repo: string }
  | { ok: false; reason: "malformed" };

/**
 * Parse an address. With `ref: true` the text must start with `@` (as inside capsule files).
 * Without, it is a CLI address like `billing#C1` where the capsule part is required.
 */
export function parseAddress(text: string, opts: { ref: boolean }): ParsedAddress {
  let s = text.trim();
  if (opts.ref) {
    if (!s.startsWith("@")) return { ok: false, reason: "malformed" };
    s = s.slice(1);
  }
  const colon = s.indexOf(":");
  if (colon >= 0) {
    const repo = s.slice(0, colon);
    // Anything that looks like `repo:...` is the reserved cross-repo form.
    if (REPO_RE.test(repo)) return { ok: false, reason: "cross-repo", repo };
    return { ok: false, reason: "malformed" };
  }
  const hash = s.indexOf("#");
  if (hash < 0) {
    if (!opts.ref) return { ok: false, reason: "malformed" };
    return NODE_ID_RE.test(s)
      ? { ok: true, capsule: null, node: s }
      : { ok: false, reason: "malformed" };
  }
  const capsule = s.slice(0, hash);
  const node = s.slice(hash + 1);
  if (!CAPSULE_ID_RE.test(capsule) || !NODE_ID_RE.test(node))
    return { ok: false, reason: "malformed" };
  return { ok: true, capsule, node };
}
