---
title: Sign-in
owners: [parth]
covers:
  - src/users/session.js
---

# Sign-in

## intent I1
Only signed-in customers can see or change their account.

## contract C1 serves @I1
A missing or expired session is always rejected. Sessions last 30 days.
checked-by: @sessions

## example E1 shows @C1
Signed in on 1 March: allowed on 30 March, rejected on 31 March.
checked-by: @sessions

## check sessions
run: node --test tests/auth/sessions.test.js
files: tests/auth/**

## decision D1 serves @C1
Short-lived sessions checked on the server, in one function every route calls.
rejected: trusting a "signed in" flag sent by the browser
