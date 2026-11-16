import assert from "node:assert/strict";
import { test } from "node:test";
import { requireUser, signIn } from "../../src/users/session.js";

const NOW = Date.UTC(2026, 2, 1);
const DAY = 24 * 60 * 60 * 1000;

test("a fresh session lets the customer in", () => {
  assert.equal(requireUser(signIn("u_1", NOW), NOW), "u_1");
});

test("no session, or one without a user, is rejected", () => {
  assert.throws(() => requireUser(null, NOW), /not signed in/);
  assert.throws(() => requireUser({ expiresAt: NOW + DAY }, NOW), /not signed in/);
});

test("a session older than 30 days is rejected", () => {
  const s = signIn("u_1", NOW);
  assert.equal(requireUser(s, NOW + 29 * DAY), "u_1");
  assert.throws(() => requireUser(s, NOW + 30 * DAY), /session expired/);
});
