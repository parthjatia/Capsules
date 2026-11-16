// The server-side checkout flow the page calls. Tested end to end in tests/web.
import { charge } from "../billing/charge.js";

export function submitCheckout({ checkoutId, totalCents }) {
  return charge({ checkoutId, amountCents: totalCents });
}
