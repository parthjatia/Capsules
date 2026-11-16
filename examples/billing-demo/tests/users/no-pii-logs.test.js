import assert from "node:assert/strict";
import { test } from "node:test";
import { log, saveUser } from "../../src/users/store.js";

test("logs never contain emails or names", () => {
  saveUser({ id: "u9", email: "grace@example.com", name: "Grace" });
  const text = log.join("\n");
  assert.ok(!text.includes("grace@example.com"));
  assert.ok(!text.includes("Grace"));
});
