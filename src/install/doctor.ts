// `capsules doctor` (C15): prove capsules doesn't affect the app. Lists every file capsules
// touched, checks none is app code or a build output, then runs the app's build and tests.
import picomatch from "picomatch";
import { runCommand } from "../checks/runner.js";
import { generatedOnDisk } from "../compile/compile.js";
import type { Project } from "../core/project.js";
import { tryGit } from "../git/history.js";
import { MANIFEST, readLocal, readManifest } from "./manifest.js";

export interface DoctorReport {
  installed: boolean;
  touched: string[];
  outsideProject: string[];
  problems: string[];
  packageJson: "unchanged" | "changed" | "absent";
  runs: {
    what: "build" | "test";
    command: string | null;
    status: "pass" | "fail" | "not configured" | "skipped";
    detail?: string;
  }[];
}

/** Places capsules may write to; anything else would be app code (B5). */
const ALLOWED = [
  ".capsules/**",
  ".claude/**",
  ".cursor/rules/**",
  "AGENTS.md",
  ".github/workflows/capsules.yml",
];
const APP_FILES = ["package.json", "**/package-lock.json", "**/pnpm-lock.yaml", "**/yarn.lock"];

export async function doctor(project: Project, run: boolean): Promise<DoctorReport> {
  const root = project.root;
  const m = readManifest(root);
  const l = readLocal(root);
  const touched = [
    ...new Set([
      ...(m ? [MANIFEST] : []),
      ...(m?.files ?? []).map((f) => f.path),
      ...generatedOnDisk(root),
      ...(m?.agentsMd ? ["AGENTS.md"] : []),
      ...(l?.settings ?? []).map((s) => s.path),
    ]),
  ].sort();
  const outsideProject = [...(l?.lines ?? []).map((x) => x.file), ...(l?.gitHooks ?? [])];
  const allowed = picomatch(ALLOWED, { dot: true });
  const outputs = project.config.build?.outputs ?? [];
  const isOutput = outputs.length ? picomatch(outputs, { dot: true }) : () => false;
  const isApp = picomatch(APP_FILES, { dot: true });
  const problems: string[] = [];
  for (const p of touched) {
    if (isApp(p)) problems.push(`${p} is an app file, and capsules must never change it`);
    else if (!allowed(p)) problems.push(`${p} is outside the folders capsules may use`);
    if (isOutput(p)) problems.push(`${p} is inside a build output (build.outputs)`);
  }
  const status = tryGit(["status", "--porcelain", "--", "package.json"], root);
  const hasPkg = tryGit(["ls-files", "--error-unmatch", "package.json"], root) !== null;
  const packageJson = !hasPkg ? "absent" : status?.trim() ? "changed" : "unchanged";

  const runs: DoctorReport["runs"] = [];
  const timeout = project.config.checks["timeout-seconds"];
  for (const what of ["build", "test"] as const) {
    const command =
      (what === "build" ? project.config.build?.command : project.config.build?.test) ?? null;
    if (!command) runs.push({ what, command, status: "not configured" });
    else if (!run) runs.push({ what, command, status: "skipped" });
    else {
      const r = await runCommand(command, root, timeout);
      const ok = r.code === 0 && !r.timedOut;
      runs.push({
        what,
        command,
        status: ok ? "pass" : "fail",
        ...(ok
          ? {}
          : { detail: (r.startError ?? r.output).trim().split("\n").slice(-15).join("\n") }),
      });
    }
  }
  return { installed: Boolean(m), touched, outsideProject, problems, packageJson, runs };
}
