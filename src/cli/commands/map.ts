import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { findProjectRoot, loadProject, toPosix, UsageError } from "../../core/project.js";
import { renderHtml } from "../../map/html.js";
import { renderMermaid } from "../../map/mermaid.js";
import { buildMap } from "../../map/model.js";
import { toJson } from "../../report/json.js";
import { errors, mapMsg } from "../../report/messages.js";
import { EXIT } from "../exit-codes.js";
import type { Io } from "../io.js";

export interface MapOptions {
  format?: string;
  out?: string;
  open?: boolean;
  base?: string;
  dryRun?: boolean;
  json?: boolean;
}

/** Open a local file with the system's default app. Local only: no network (B1). */
function openLocal(path: string): void {
  const [cmd, args] =
    process.platform === "win32"
      ? ["explorer.exe", [path]]
      : process.platform === "darwin"
        ? ["open", [path]]
        : ["xdg-open", [path]];
  try {
    const child = spawn(cmd, args, { detached: true, stdio: "ignore", windowsHide: true });
    child.on("error", () => undefined);
    child.unref();
  } catch {
    // Opening is a convenience; the path is printed either way.
  }
}

export function map(io: Io, opts: MapOptions): number {
  const format = opts.format ?? "html";
  if (format !== "html" && format !== "mermaid" && format !== "json")
    throw new UsageError(errors.mapFormat(format));
  if (opts.open && format !== "html") throw new UsageError(errors.mapOpenNeedsHtml());

  const project = loadProject(findProjectRoot(io.cwd));
  const model = buildMap(project, opts.base ? { base: opts.base } : {});
  const text =
    format === "html"
      ? renderHtml(model)
      : format === "mermaid"
        ? renderMermaid(model)
        : toJson("map", { ...model });

  // Mermaid and JSON go to stdout unless --out is given; HTML always goes to a file.
  const target = opts.out
    ? resolve(io.cwd, opts.out)
    : format === "html"
      ? join(project.root, ".capsules", "_cache", "map.html")
      : null;
  if (!target) {
    io.out(text);
    return EXIT.ok;
  }
  const shown = toPosix(target);
  if (opts.dryRun) {
    io.out(mapMsg.dryRun(shown));
    return EXIT.ok;
  }
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, text);
  if (opts.json) io.out(toJson("map-written", { path: shown, summary: model.summary.line }));
  else io.out(mapMsg.wrote(shown, model.summary.line, Boolean(opts.open)));
  if (opts.open) openLocal(target);
  return EXIT.ok;
}
