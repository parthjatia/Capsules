// Every test starts outside any agent session and outside GitHub Actions' pull request event,
// whatever shell runs `npm test`. Inside Claude Code, the SessionStart hook sets
// CAPSULES_SESSION for every shell command (C18.1), and CI sets GITHUB_EVENT_PATH; both would
// otherwise change who capsules thinks is acting. Tests that need them set them explicitly.
for (const name of [
  "CAPSULES_SESSION",
  "CLAUDECODE",
  "CLAUDE_CODE_SESSION_ID",
  "CLAUDE_ENV_FILE",
  "GITHUB_ACTIONS",
  "GITHUB_EVENT_PATH",
])
  delete process.env[name];
