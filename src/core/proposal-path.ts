// Where proposals live (C18.3). Kept free of YAML so the fast hook entry (D-010) can use it.
export const PROPOSALS_DIR = ".capsules/_proposals";

export const isProposalPath = (p: string) => p.startsWith(`${PROPOSALS_DIR}/`);

/** The capsule a proposal file is about, from its name (`<capsule>--…`). */
export function proposalCapsule(path: string): string {
  const name = path.slice(PROPOSALS_DIR.length + 1);
  const i = name.indexOf("--");
  return i > 0 ? name.slice(0, i) : "root";
}
