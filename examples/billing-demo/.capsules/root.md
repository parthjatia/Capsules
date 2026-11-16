---
title: Billing demo
owners: [parth]
---

# Billing demo

## intent I1
Small teams pay a monthly plan, get one correct invoice per period, and can check out in a few clicks.

## contract C1 serves @I1
Every money amount is a whole number of cents. Never use floating-point currency.
checked-by: @all-tests

## check all-tests
run: npm test
files: tests/**

## decision D1 serves @C1
Store and pass money as integer cents everywhere.
rejected: decimal strings (every caller would need to parse them)
