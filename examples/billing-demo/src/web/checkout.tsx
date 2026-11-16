// Checkout page. Totals and tax come from the server; the page only displays them.
import { charge } from "../billing/charge.js";

type Props = { checkoutId: string; totalCents: number; email: string };

export function Checkout({ checkoutId, totalCents, email }: Props) {
  const onPay = () => charge({ checkoutId, amountCents: totalCents });
  return (
    <form onSubmit={onPay}>
      <p>Receipt goes to {email}</p>
      <p>Total: {(totalCents / 100).toFixed(2)}</p>
      <button type="submit">Pay</button>
    </form>
  );
}
