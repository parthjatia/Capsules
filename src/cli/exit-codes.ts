// Exit codes from C15. Every command uses these names, never bare numbers.
export const EXIT = {
  ok: 0,
  problems: 1,
  hookBlock: 2,
  usage: 64,
  internal: 70,
} as const;
