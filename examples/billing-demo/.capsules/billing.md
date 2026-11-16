---
title: Billing
covers:
  - src/billing/**
  - tests/payments/**
---

# Billing

## intent I1
Charge each customer the right amount for their plan.

## contract C1 serves @I1
Plan prices live only in src/billing/plan.js. No other file hard-codes a price.
checked-by: @root#all-tests

## context pricing
Prices are in cents (see {{ @root#C1 }}). Look a price up with priceOf(planId).
