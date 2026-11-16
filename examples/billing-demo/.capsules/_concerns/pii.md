---
title: Personal data
owners: [parth]
covers:
  - src/users/**
  - src/web/checkout.tsx
---

# Personal data

## intent I1
Customers' personal data stays private.

## contract C1 serves @I1
Never write emails or names to logs.
checked-by: @no-pii-logs

## check no-pii-logs
run: node --test tests/users/no-pii-logs.test.js
files: tests/users/**
