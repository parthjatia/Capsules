import assert from "node:assert/strict";
import { test } from "node:test";
import { charge, chargeCount } from "../../src/billing/charge.js";

test("paying twice for one checkout charges once", () => {
  const before = chargeCount();
  const a = charge({ checkoutId: "co_1", amountCents: 2900 });
  const b = charge({ checkoutId: "co_1", amountCents: 2900 });
  assert.equal(a.id, b.id);
  assert.equal(chargeCount(), before + 1);
});
