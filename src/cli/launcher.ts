// The `capsules` binary. `capsules hook …` loads only the hook code so agent hooks stay fast
// (C11, D-010); every other command loads the full CLI.
const args = process.argv.slice(2);
if (args[0] === "hook") {
  const { runHook } = await import("../hooks/main.js");
  process.exitCode = await runHook(args.slice(1));
} else {
  const { main } = await import("./index.js");
  process.exitCode = await main(process.argv);
}
