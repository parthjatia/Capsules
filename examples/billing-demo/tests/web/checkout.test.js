import assert from "node:assert/strict";
import { test } from "node:test";
import { submitCheckout } from "../../src/web/checkout-flow.js";

test("checkout charges the total the server computed", () => {
  const result = submitCheckout({ checkoutId: "co_web_1", totalCents: 1234 });
  assert.equal(result.amountCents, 1234);
});
