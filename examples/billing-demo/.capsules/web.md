---
title: Web
covers:
  - src/web/**
  - tests/web/**
---

# Web

## intent I1
Customers can see their cart and pay in a few clicks.

## contract C1 serves @I1
Pages show totals computed by the server. They never calculate prices or tax themselves.
checked-by: @checkout-e2e

## check checkout-e2e
run: node --test tests/web/checkout.test.js
files: tests/web/**

## decision D1 serves @C1
Calculate tax in the browser for instant feedback.

## decision D2 serves @C1 supersedes @D1
Compute totals and tax on the server and send them to the page.
rejected: client-side tax calculation
