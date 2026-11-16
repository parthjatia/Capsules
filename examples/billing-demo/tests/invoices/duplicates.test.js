import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { allInvoices, createInvoice, resetInvoices } from "../../src/billing/invoices/create.js";

beforeEach(() => resetInvoices());

test("two CreateInvoice calls for the same customer and period make one invoice", () => {
  const a = createInvoice({ customerId: "A", period: "2026-03", amountCents: 900 });
  const b = createInvoice({ customerId: "A", period: "2026-03", amountCents: 900 });
  assert.equal(a.id, b.id);
  assert.equal(allInvoices().length, 1);
});

test("different periods make different invoices", () => {
  createInvoice({ customerId: "A", period: "2026-03", amountCents: 900 });
  createInvoice({ customerId: "A", period: "2026-04", amountCents: 900 });
  assert.equal(allInvoices().length, 2);
});

test("refunds are netted off the invoice", () => {
  const inv = createInvoice({
    customerId: "B",
    period: "2026-03",
    amountCents: 900,
    refundedCents: 200,
  });
  assert.equal(inv.amountCents, 700);
});
