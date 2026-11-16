---
title: Users
covers:
  - src/users/**
  - tests/users/**
---

# Users

## intent I1
Keep each customer's profile so invoices and receipts reach the right person.

## contract C1 serves @I1
Every saved user has an id, and saving the same id again replaces the profile.
checked-by: @root#all-tests
