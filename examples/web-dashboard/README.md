# Worked example: an operator dashboard for an order service

A small Starlette dashboard inside a larger `orders` package. It shows service
state and forwards a few operator commands. This example shows how a prose rule
becomes a principle plus a checked manifest.

## Before: limits written as prose

A rules file (CLAUDE.md, AGENTS.md, Cursor rules...) said:

> The dashboard must only use `orders.core.contract`, never the engine or the
> database. It may only expose `GET /`, `GET /api/status`, `POST /api/pause`,
> `POST /api/resume` and `POST /api/orders/{id}/cancel`; refunds and data repair
> are CLI-only. Bind to 127.0.0.1. Never log `ORDERS_API_TOKEN`. Don't shell out.

Nothing checks any of it. An agent adding "just one more admin route" or
importing the engine "temporarily" breaks the rule without anyone noticing, and
the text drifts from the code.

## After: a principle and a manifest

The rules file keeps only principles, imported from the kit
(`@.boundaries/rules.md`), and points to the manifest:

> The dashboard's limits are in `.boundaries/dashboard.toml`.

[`.boundaries/dashboard.toml`](.boundaries/dashboard.toml) holds every limit, and
`boundaries check` verifies each one:

| Prose rule | Manifest key | How it is checked |
|---|---|---|
| only the core contract | `imports.internal` | AST import scan of `src/orders/dashboard` |
| Starlette, Jinja; uvicorn only in the server module | `imports.external` (with `only_from`) | same scan |
| don't shell out, no files, no database | `calls.forbidden` | AST call scan with alias resolution |
| exactly these five routes | `[[entrypoints]]` `exact` | `boundary.http_routes()` reads `app.routes` |
| loopback only | `runtime.bind` | `boundary.bind_hosts()` reads the real settings |
| never leak the token | `runtime.secrets` | a sentinel token is planted, `boundary.secret_probe()` drives every route, and responses, stdout, stderr and logs are searched in several encodings |
| don't touch the providers | `protected.paths` | the hook asks before edits; CODEOWNERS and CI cover the rest |

The decision behind the limits is
[`docs/decisions/0001-dashboard-boundary.md`](docs/decisions/0001-dashboard-boundary.md).
Changing the manifest needs a new decision record (`boundaries diff`).

## Files

- `src/orders/dashboard/app.py`: the Starlette app.
- `src/orders/dashboard/boundary.py`: the protected providers and the probe.
- `src/orders/dashboard/server.py`: the uvicorn entry point.
- `src/orders/dashboard/settings.py`: bind address and the token loader (see
  "Settings module" below).

## Settings module

`app.py`, `server.py` and `boundary.py` import `settings` (a frozen dataclass
with `host = "127.0.0.1"` and `port = 8400`) and `api_token()` (returns the
`ORDERS_API_TOKEN` value from the process environment, or an empty string) from
`orders.dashboard.settings`. Add that module when you copy the example; the
manifest does not depend on how it is written.

## Running it

The repository's cross tests validate this example with both adapters. To run
the full check, install `starlette`, `jinja2`, `uvicorn` and `httpx` plus the kit,
then run `boundaries check` in this folder.
