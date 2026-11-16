// Monthly plans, priced in cents.
export const PLANS = {
  starter: { name: "Starter", priceCents: 900 },
  team: { name: "Team", priceCents: 2900 },
};

export function priceOf(planId) {
  const plan = PLANS[planId];
  if (!plan) throw new Error(`unknown plan: ${planId}`);
  return plan.priceCents;
}
