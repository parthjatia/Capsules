// A refund never exceeds what was charged.
export function refund(invoice, amountCents) {
  if (amountCents <= 0) throw new Error("refund amount must be positive");
  if (amountCents > invoice.amountCents) throw new Error("refund exceeds the amount charged");
  return { invoiceId: invoice.id, amountCents };
}
