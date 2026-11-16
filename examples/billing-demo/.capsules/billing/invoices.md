---
title: Invoices
owners: [parth]
covers:
  - src/billing/invoices/**
  - tests/invoices/**
  - prompts/invoice-agent.md
excludes: []
status: active
---

# Invoices

## intent I1
Each customer is charged exactly once per billing period, net of refunds.

## contract C1 serves @I1
Never create two invoices for the same customer and period.
checked-by: @no-duplicates

## contract C2 serves @I1
A refund never exceeds the amount charged.
checked-by: @refunds

## example E1 shows @C1
Customer A, period 2026-03, two CreateInvoice calls -> one invoice.
checked-by: @no-duplicates

## check no-duplicates
run: node --test tests/invoices/duplicates.test.js
files: tests/invoices/duplicates.test.js

## check refunds
run: node --test tests/invoices/refunds.test.js
files: tests/invoices/refunds.test.js

## assumption A3
Fewer than 1,000 invoices per minute.
review-by: 2027-06-01

## decision D3 serves @C1
Build our own invoice ledger.

## decision D7 serves @C1 assumes @A3 supersedes @D3
Use an idempotency key per customer and period when creating invoices.
rejected: own ledger (3 weeks of work, no audit trail)

## context idempotency derived-from @D7
Idempotency keys are built from customer_id + period.
Always pass both. {{ @C1 }}

## prompt invoice-agent
file: prompts/invoice-agent.md

## code create-invoice implements @C1
src/billing/invoices/create.js#createInvoice
