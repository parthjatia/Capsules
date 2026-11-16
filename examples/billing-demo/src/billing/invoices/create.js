// Creates at most one invoice per customer and billing period.
const invoices = new Map();

export function idempotencyKey(customerId, period) {
  return `${customerId}:${period}`;
}

export function createInvoice({ customerId, period, amountCents, refundedCents = 0 }) {
  const key = idempotencyKey(customerId, period);
  const existing = invoices.get(key);
  if (existing) return existing;
  const invoice = {
    id: `inv_${invoices.size + 1}`,
    customerId,
    period,
    amountCents: amountCents - refundedCents,
  };
  invoices.set(key, invoice);
  return invoice;
}

export function allInvoices() {
  return [...invoices.values()];
}

export function resetInvoices() {
  invoices.clear();
}
