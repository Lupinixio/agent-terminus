# Manifest reference

A manifest is `.boundaries/<component>.toml`: the hard limits of one component.
The canonical schema is [`schema/manifest.schema.json`](../schema/manifest.schema.json)
(JSON Schema 2020-12, `additionalProperties: false` everywhere). Optional project
configuration lives in `.boundaries/kit.toml` ([`schema/kit.schema.json`](../schema/kit.schema.json)).

Every key in a manifest must be checked by the adapter of the component's
language; a key the adapter does not check is a config error (exit 3), never a
silent pass. Manifests of another language are reported as `skipped`.

## Contents

- [Top level](#top-level)
- [`[component]`](#component)
- [`[imports]`](#imports)
- [`[calls]`](#calls)
- [`[[entrypoints]]`](#entrypoints)
- [`[runtime]`](#runtime)
- [`[protected]`](#protected)
- [Adapter rules beyond the schema](#adapter-rules-beyond-the-schema)
- [`kit.toml`](#kittoml)
- [Support matrix](#support-matrix)
- [Providers and probes (Starlette example)](#providers-and-probes-starlette-example)

## Top level

| Key | Type | Meaning |
|---|---|---|
| `schema_version` | `1` | Bumped only on a breaking change of meaning. New keys do not bump it: older adapters already fail loudly on keys they do not know. |

## `[component]`

| Key | Required | Meaning |
|---|---|---|
| `name` | yes | `^[a-z][a-z0-9-]{0,62}$`, not `kit`, and equal to the file stem. |
| `language` | yes | `"python"` or `"node"`. |
| `root` | yes | Project-relative source directory. |
| `package` | Python only | Dotted import name of `root` (for example `orders.dashboard`). Node manifests must not set it. |
| `exclude` | no | Globs (`*`, `**`, `?`) left out of the import and call scans. |
| `principle` | yes | One sentence (1–300 characters) saying what the component is for. |
| `decisions` | yes | At least one decision record (project-relative path); each must exist. |

Paths never start with `/` or `\`, never contain a drive letter or a `..` segment.

## `[imports]`

When present, `internal`, `external` and `builtin` are all required, so nothing is
allowed by default. Each is `"any"` or an array of targets; a target is a string or
`{ target = "...", only_from = ["..."] }` (the importer must be inside one of
`only_from`). An entry covers the target and everything below it. The component
itself is always allowed.

| Kind | Python | Node |
|---|---|---|
| `internal` | dotted modules (`orders.core.contract`) | project-relative paths (`src/core/contract.js`, or a directory) |
| `external` | top-level import names (`yaml`, not `PyYAML`) | npm package names (`smol-toml`, `@babel/parser`) |
| `builtin` | stdlib top-level names (`sys.stdlib_module_names`) | core modules without `node:` (`fs`, `path`) |
| `only_from` | dotted modules | project-relative paths |

**Python** (own AST scanner): every `import` and `from ... import` under `root`
counts, including imports under `if TYPE_CHECKING:` and inside functions.
Relative imports are resolved. Classification by top-level name: internal if it is
the top of `package` or of an internal target, builtin if it is in the standard
library, external otherwise. `from X import n` passes when `X.n` or `X` is allowed.
`from __future__ import ...` is never reported. Dynamic imports
(`importlib.import_module`) are not seen; forbid them under `[calls]`.

**Node** (dependency-cruiser, optional peer `^18`): the adapter turns the lists
into dependency-cruiser rules and runs `cruise()` in memory. Package `exports` are
resolved like Node does, `tsconfig` paths work through `kit.toml node.tsconfig`, and
an import that cannot be resolved is a violation, so dynamic or unresolved imports
are loud. The same rules are written to `.boundaries/generated/depcruise.cjs` for
projects that want them in their own dependency-cruiser config.

## `[calls]`

`forbidden` is a non-empty array of patterns or `{ pattern = "...", reason = "..." }`.

| Pattern | Matches |
|---|---|
| `name` | an unbound bare call: `open(...)`, `fetch(...)`, `eval(...)`; in Python also `builtins.name(...)` |
| `mod.attr` | the resolved dotted name after import aliases: `import subprocess as sp; sp.run()` is `subprocess.run`; `import { exec as x } from 'node:child_process'` is `child_process.exec` |
| `*.attr` | any attribute call ending in `attr` (`f.open()`, `self.client.open()`) |
| `*` inside a segment | per-segment wildcard: `subprocess.*`, `fs.write*` |

Bare names count only when no import binds them (`from os import open; open()` is
`os.open`, not `open`). In Node, `new X()` counts as a call, `node:` prefixes are
stripped, every `/` in a module specifier becomes `.` (`readFile` from
`node:fs/promises` is `fs.promises.readFile`, `get` from `@scope/pkg` is
`@scope.pkg.get`), and `require()` destructuring, default and namespace imports
are resolved. So `fs.*` does not cover `node:fs/promises`; add `fs.promises.*`.
A source file that does not parse is a config error.

## `[[entrypoints]]`

An array of groups, each `{ name, provider, exact }`. The provider returns the
component's real entry points (routes, commands, tools...). The kit asserts set
equality with `exact` after trimming and collapsing whitespace, and reports every
missing and extra entry.

```toml
[[entrypoints]]
name = "http"
provider = "orders.dashboard.boundary:http_routes"   # Python: module:attribute
exact = ["GET /", "GET /api/status", "POST /api/pause"]
```

Node references are `./path/to/file.js#exportName` (relative to the project root);
the export may be async and the file may be `.ts` (Node type stripping).

## `[runtime]`

At least one of:

- `bind = { hosts = [...], provider = "<ref>" }`: every host the provider returns
  must be in `hosts`; an empty result is a violation.
- `secrets = { names = [...], probe = "<ref>" }`: the kit sets each name to a fresh
  sentinel (`bk_` + 32 hex characters) in the process environment, runs the probe
  with stdout, stderr and logging captured (Python: `redirect_stdout`,
  `redirect_stderr` and a root logging handler; Node: `console.*` and
  `process.stdout/stderr.write`), restores everything, and searches the returned
  strings and the captured output for: the raw sentinel, each 16-character half,
  the URL-quoted form, base64 and urlsafe base64 (at every byte alignment), the
  JSON-escaped form and `repr`.

## `[protected]`

`paths` is a non-empty array of project-relative paths or globs. They are added to
`.boundaries/generated/index.json`, which the agent hook reads, and to the
CODEOWNERS block printed by `boundaries codeowners`. A non-glob path must exist; a
glob must match at least one file.

The built-in protected list (`schema/builtin-protected.json`) is always included:
`.boundaries/**`, the hook, the Claude Code settings files, `.githooks/pre-commit`,
the boundaries workflow and the CODEOWNERS files.

## Adapter rules beyond the schema

Config errors (exit 3) unless noted:

- `component.name` equals the file stem;
- decision files exist; `component.root` is a directory;
- protected paths exist (globs match at least one file);
- references use the language's form (`module:attr` or `./file.js#export`);
- import targets use the language's syntax;
- **every provider and probe source file is covered by `protected.paths`** (or the
  kit's protected list). This one is a violation (exit 1) under `protected.paths`,
  so an agent cannot quietly change the code that reports what a component exposes.

## `kit.toml`

Optional. `kit` is a reserved component name.

| Key | Meaning |
|---|---|
| `schema_version` | `1` |
| `decisions` | Decision records for kit-level changes and manifest deletions (`boundaries diff` counts them). |
| `rules_lint.files` | Globs that replace the default rules files scanned by `boundaries lint-rules`. |
| `rules_lint.allow` | Identifiers `lint-rules` may find in rules files. The only escape hatch; protected like every file under `.boundaries/`. |
| `protected.paths` | Extra protected paths for the hook and CODEOWNERS. |
| `hook.decision` | `"ask"` (default) or `"deny"`. |
| `python.sys_path` | Project-relative directories put on `sys.path` for providers (for a `src/` layout). |
| `node.tsconfig` | tsconfig passed to dependency-cruiser. |

Each adapter ignores the other language's section.

## Support matrix

Which adapter checks which key (generated from `boundaries keys --json`; the cross
tests fail if this table drifts).

<!-- keys:start -->
| Key | python | node |
|---|---|---|
| `calls.forbidden` | yes | yes |
| `calls.forbidden[].pattern` | yes | yes |
| `calls.forbidden[].reason` | yes | yes |
| `component.decisions` | yes | yes |
| `component.exclude` | yes | yes |
| `component.language` | yes | yes |
| `component.name` | yes | yes |
| `component.package` | yes | no |
| `component.principle` | yes | yes |
| `component.root` | yes | yes |
| `entrypoints[].exact` | yes | yes |
| `entrypoints[].name` | yes | yes |
| `entrypoints[].provider` | yes | yes |
| `imports.builtin` | yes | yes |
| `imports.builtin[].only_from` | yes | yes |
| `imports.builtin[].target` | yes | yes |
| `imports.external` | yes | yes |
| `imports.external[].only_from` | yes | yes |
| `imports.external[].target` | yes | yes |
| `imports.internal` | yes | yes |
| `imports.internal[].only_from` | yes | yes |
| `imports.internal[].target` | yes | yes |
| `protected.paths` | yes | yes |
| `runtime.bind.hosts` | yes | yes |
| `runtime.bind.provider` | yes | yes |
| `runtime.secrets.names` | yes | yes |
| `runtime.secrets.probe` | yes | yes |
| `schema_version` | yes | yes |
<!-- keys:end -->

## Providers and probes (Starlette example)

Providers must read the framework's **real registry**, never a hand-written list:
a list in the provider would only restate the manifest and prove nothing. Keep
them in one small module and protect it. From
[`examples/web-dashboard`](../examples/web-dashboard):

```python
# src/orders/dashboard/boundary.py  (listed in [protected])
from starlette.routing import Route
from starlette.testclient import TestClient

from orders.dashboard.app import app
from orders.dashboard.settings import api_token, settings


def http_routes() -> list[str]:
    out = []
    for route in app.routes:
        if isinstance(route, Route):
            out += [f"{m} {route.path}" for m in sorted(route.methods or ()) if m != "HEAD"]
    return out


def bind_hosts() -> list[str]:
    return [settings.host]


def secret_probe() -> list[str]:
    client = TestClient(app)
    seen = []
    for credentials in (f"Bearer {api_token()}", "Bearer wrong"):
        for line in http_routes():
            method, path = line.split(" ", 1)
            response = client.request(method, path.replace("{id}", "42"), headers={"authorization": credentials})
            seen.append(f"{line} -> {response.status_code} {dict(response.headers)} {response.text}")
    return seen
```

The probe exercises the code paths that handle the secret and returns what an
outsider would see; the kit plants the sentinel before calling it and searches the
result plus everything printed or logged.

For Node, export async functions from a `.js` or `.ts` module and reference them
as `./src/dashboard/boundary.ts#httpRoutes`.
