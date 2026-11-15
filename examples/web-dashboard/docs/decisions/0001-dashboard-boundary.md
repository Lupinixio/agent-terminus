# 0001 Dashboard boundary

Status: accepted

## Context

The order service gets an operator dashboard. It must not become a second way
to change orders: storage, refunds and data repair stay in the core and the
admin CLI.

## Decision

- The dashboard reads state and sends commands only through
  `orders.core.contract`; it never imports the core's internals or storage.
- It exposes a fixed set of HTTP routes. Admin operations are CLI-only, so they
  are absent from the declared set and adding one fails the check.
- It binds to loopback only; remote access goes through the existing tunnel.
- The API token it checks must never appear in responses or logs.

The limits are in `.boundaries/dashboard.toml`; the providers that report the
real routes and bind address are in `src/orders/dashboard/boundary.py`, which is
protected.

## Consequences

A new route, a new dependency or a wider bind address needs a new decision
record and an approved manifest change.
