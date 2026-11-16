import assert from "node:assert/strict";
import { test } from "node:test";
import { refund } from "../../src/billing/invoices/refund.js";

test("a refund never exceeds the amount charged", () => {
  const invoice = { id: "inv_1", amountCents: 900 };
  assert.throws(() => refund(invoice, 901), /exceeds/);
  assert.deepEqual(refund(invoice, 900), { invoiceId: "inv_1", amountCents: 900 });
});
