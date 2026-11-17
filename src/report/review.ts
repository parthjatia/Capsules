// The text of `capsules review` (C18.4): risky items first and in full, routine items last,
// one line each. Plain words; no colours, no timestamps.
import type { ReviewItem } from "../core/review.js";

export function renderReview(items: ReviewItem[]): string {
  const risky = items.filter((i) => i.group === "risky");
  const routine = items.filter((i) => i.group === "routine");
  if (!items.length)
    return "capsules review: nothing is waiting for you. No changed rules or tests, no proposals.\n";
  const out = [
    `capsules review: ${risky.length} item${risky.length === 1 ? "" : "s"} to read, ${routine.length} routine.`,
  ];
  if (risky.length) {
    out.push("", "Read these (rules, intents, examples, tests and proposals):");
    for (const i of risky) {
      out.push("", `${(i.id ?? "--").padEnd(4)}${i.title}`);
      for (const d of i.detail) out.push(`      ${d}`);
      out.push(`      → ${i.hint}${i.id ? ` Approve: capsules review approve ${i.id}` : ""}`);
    }
  }
  if (routine.length) {
    out.push("", "Routine (one line each):");
    for (const i of routine) out.push(`${(i.id ?? "--").padEnd(4)}${i.title} → ${i.hint}`);
  }
  out.push(
    "",
    "Approve items: capsules review approve r1 r2 …   All routine items: capsules review approve --routine",
    "(--routine never includes a rule, an intent, an example or a test.) Run these in your own terminal.",
  );
  return out.join("\n") + "\n";
}
