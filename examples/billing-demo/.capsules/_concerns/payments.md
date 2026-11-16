---
title: Payments
owners: [parth]
covers:
  - src/billing/**
  - src/web/checkout.tsx
  - src/web/checkout-flow.js
---

# Payments

## intent I1
Customers are never charged more than they agreed to pay.

## contract C1 serves @I1
Never charge a card twice for one checkout.
checked-by: @no-double-charge

## contract C2 serves @I1
Only code in src/billing/ calls the payment provider.
checked-by: @root#all-tests

## check no-double-charge
run: node --test tests/payments/double-charge.test.js
files: tests/payments/**
