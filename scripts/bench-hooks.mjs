// Measures hook speed on a 1,000-file copy of the demo app (C11 targets: under 150 ms on
// macOS and Linux, under 300 ms on Windows). Run: npm run build && node scripts/bench-hooks.mjs
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..");
const CLI = join(ROOT, "dist", "cli.js");
const dir = mkdtempSync(join(tmpdir(), "capsules-bench-"));
try {
  cpSync(join(ROOT, "examples", "billing-demo"), dir, { recursive: true });
  for (let i = 0; i < 1000; i++) {
    const sub = join(dir, "src", "web", `part${Math.floor(i / 100)}`);
    mkdirSync(sub, { recursive: true });
    writeFileSync(join(sub, `file${i}.js`), `export const n${i} = ${i};\n`);
  }
  const git = (...a) => spawnSync("git", a, { cwd: dir, encoding: "utf8" });
  git("init", "-q");
  git("add", "-A");
  git("-c", "user.email=bench@example.com", "-c", "user.name=bench", "commit", "-qm", "bench");

  const cases = {
    "pre-edit": {
      session_id: "bench",
      tool_name: "Edit",
      tool_input: {
        file_path: join(dir, "src", "web", "part3", "file300.js"),
        old_string: "export",
        new_string: "export",
      },
    },
    "pre-bash": { session_id: "bench", tool_name: "Bash", tool_input: { command: "npm test" } },
  };
  const limit = process.platform === "win32" ? 300 : 150;
  let ok = true;
  for (const [event, input] of Object.entries(cases)) {
    const body = JSON.stringify({ cwd: dir, ...input });
    const once = () => {
      const t = process.hrtime.bigint();
      const r = spawnSync(process.execPath, [CLI, "hook", event], { cwd: dir, input: body });
      if (r.status !== 0) throw new Error(`${event} exited ${r.status}: ${r.stderr}`);
      return Number(process.hrtime.bigint() - t) / 1e6;
    };
    const cold = once(); // builds the saved index
    const runs = Array.from({ length: 10 }, once).sort((a, b) => a - b);
    const median = runs[5];
    ok &&= median < limit;
    console.log(
      `${event.padEnd(8)}  first run ${cold.toFixed(0)} ms (builds the index), then median ${median.toFixed(0)} ms (target under ${limit} ms)`,
    );
  }
  const node = (() => {
    const t = process.hrtime.bigint();
    spawnSync(process.execPath, ["-e", "0"]);
    return Number(process.hrtime.bigint() - t) / 1e6;
  })();
  console.log(`(node itself takes about ${node.toFixed(0)} ms to start on this machine)`);
  process.exitCode = ok ? 0 : 1;
} finally {
  rmSync(dir, { recursive: true, force: true });
}
