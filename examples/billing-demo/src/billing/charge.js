// Charges a card exactly once per checkout attempt.
const charges = new Map();

export function charge({ checkoutId, amountCents }) {
  if (charges.has(checkoutId)) return charges.get(checkoutId);
  const result = { id: `ch_${charges.size + 1}`, checkoutId, amountCents };
  charges.set(checkoutId, result);
  return result;
}

export function chargeCount() {
  return charges.size;
}
