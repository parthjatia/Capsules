// `capsules map --format mermaid` (C14): the area tree and the concerns, as a Mermaid flowchart
// for READMEs and pull requests. GitHub draws it from a ```mermaid block.
import { plural } from "../report/text.js";
import type { MapModel } from "./model.js";

/** Mermaid ids allow letters, digits and `_`; ids here use `-` and `.`, which are mapped apart. */
const mid = (prefix: string, id: string) => prefix + id.replace(/-/g, "_h").replace(/\./g, "_d");
const label = (s: string) =>
  s.replace(/&/g, "#amp;").replace(/"/g, "#quot;").replace(/</g, "#lt;").replace(/>/g, "#gt;");

export function renderMermaid(model: MapModel): string {
  const lines = ["flowchart TD"];
  const areas = model.capsules.filter((c) => c.kind === "area");
  const concerns = model.capsules.filter((c) => c.kind === "concern");
  for (const a of areas) {
    const cls = [
      ...(a.status === "draft" ? ["draft"] : []),
      ...(a.stale || a.checks.some((k) => k.status === "fail" || k.status === "timeout")
        ? ["attention"]
        : []),
    ];
    lines.push(
      `  ${mid("a_", a.id)}["${label(a.title)}<br/><small>${label(a.id)} · ${plural(a.contracts.length, "rule")}</small>"]${cls.length ? `:::${cls[0]}` : ""}`,
    );
  }
  for (const a of areas)
    if (a.parent && areas.some((p) => p.id === a.parent))
      lines.push(`  ${mid("a_", a.parent)} --> ${mid("a_", a.id)}`);
  for (const k of concerns) {
    lines.push(`  ${mid("k_", k.id)}(["${label(k.id)}: ${label(k.title)}"]):::concern`);
    for (const a of k.related)
      if (areas.some((x) => x.id === a)) lines.push(`  ${mid("k_", k.id)} -.- ${mid("a_", a)}`);
  }
  lines.push(
    "  classDef concern fill:#efe6fa,stroke:#5b2f99,color:#2a1747",
    "  classDef draft stroke-dasharray:4 3",
    "  classDef attention stroke:#b3261e,stroke-width:2px",
  );
  return lines.join("\n") + "\n";
}
