---
title: Capsules
owners: [parth]
covers:
  - "**"
status: active
---

# Capsules

## intent I1
Give people and agents a reliable, nested picture of what each part of an AI-built app is for.

## intent I2
Stop AI agents from quietly breaking that picture, especially by weakening the tests that judge their own code.

## contract C1 serves @I1, @I2
The tool never calls an AI and never makes a network request.
checked-by: @no-network

## contract C2 serves @I1
docs/SPEC.md is always identical to Part C of CLAUDE.md.
checked-by: @spec-sync

## check no-network
run: npx vitest run test/unit/no-network.test.ts
files: test/unit/no-network.test.ts

## check spec-sync
run: npm run spec:check
files: test/unit/spec-sync.test.ts

## decision D1 serves @C1
Keep the tool deterministic and offline. Thinking work is done by the user's own agent.
rejected: built-in LLM calls (model bills, privacy, non-deterministic output)
