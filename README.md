# Agent Terminus

**Agent boundaries, set in stone.**

Named after Terminus, the Roman god of boundaries, whose boundary stones could
not be moved. Agent Terminus (`agent-terminus`) turns a project's hard limits
into checks that AI coding agents cannot talk their way past.

Hard project limits as checked manifests; AI rules as principles only.

## The problem

Rules files for AI coding agents (`CLAUDE.md`, `AGENTS.md`, Cursor rules, Copilot
instructions...) end up holding two very different things:

- **principles**: "prefer enforcement on the receiving side", "propose, don't
  apply, changes to limits";
- **hard limits**: "the dashboard must not import the engine", "only these five
  routes", "bind to 127.0.0.1", "never log the API token".

Agents follow prose unreliably, nobody checks it, and it drifts from the code.
Hard limits belong in code that fails a build.

## The concept

1. **Principles** stay in rules files. The kit ships one short text,
   [`rules/boundaries.md`](rules/boundaries.md), to import or copy.
2. **Limits** live in `.boundaries/<component>.toml` manifests and are checked by
   `boundaries check`, one adapter per language (Python and Node/TypeScript).
3. **Protection** of the limits and their checks, in three tiers:
   - an agent hook that asks a human before edits to manifests, providers and
     other protected paths;
   - a git pre-commit hook;
   - CODEOWNERS plus branch protection with the CI job required. This is the
     only tier that cannot be bypassed locally. See
     [docs/protecting-checks.md](docs/protecting-checks.md).

The manifests are the single source of truth; checks read them when they run.
The only generated files (`.boundaries/generated/`) are verified fresh.

## What can be limited

| Manifest key | Checked by |
|---|---|
| `[imports]` internal / external / builtin, with `only_from` | Python: AST import scan. Node: dependency-cruiser |
| `[calls] forbidden` | AST call scan with import-alias resolution (`sp.run` is `subprocess.run`) |
| `[[entrypoints]] exact` | a provider returns the real routes/commands; set equality |
| `[runtime.bind] hosts` | a provider returns the real bind addresses |
| `[runtime.secrets] names` | a sentinel is planted per name; a probe drives the code; output, logs and return values are searched in several encodings |
| `[protected] paths` | the hook, the CODEOWNERS block, and "every provider file must be protected" |
| `component.decisions` | every manifest links a decision record; `boundaries diff` requires a new one when `.boundaries/` changes |

Full reference: [docs/manifest.md](docs/manifest.md). A worked example, before
and after: [examples/web-dashboard](examples/web-dashboard).

```toml
# .boundaries/dashboard.toml
schema_version = 1

[component]
name = "dashboard"
language = "python"
root = "src/orders/dashboard"
package = "orders.dashboard"
principle = "Operator view; reads state and sends commands through the core contract only."
decisions = ["docs/decisions/0001-dashboard-boundary.md"]

[imports]
internal = ["orders.clock", "orders.core.contract"]
external = ["starlette", { target = "uvicorn", only_from = ["orders.dashboard.server"] }]
builtin = ["hmac", "logging", "os"]

[calls]
forbidden = ["open", "*.open", { pattern = "subprocess.*", reason = "no child processes" }]

[[entrypoints]]
name = "http"
provider = "orders.dashboard.boundary:http_routes"
exact = ["GET /", "GET /api/status", "POST /api/pause"]

[runtime.bind]
hosts = ["127.0.0.1"]
provider = "orders.dashboard.boundary:bind_hosts"

[protected]
paths = ["src/orders/dashboard/boundary.py"]
```

## Quick start

### Python

```sh
uv add --dev "agent-terminus @ git+https://github.com/Lupinixio/agent-terminus@v0.1.0#subdirectory=python"
uv run boundaries check
```

Write `.boundaries/kit.toml` (set `[python] sys_path = ["src"]` for a `src/`
layout) and one manifest per component, then `uv run boundaries generate`. The
`init` and `lint-rules` commands come from the Node CLI:
`npx --yes --package=github:Lupinixio/agent-terminus#v0.1.0 boundaries init`.

Optional: the pytest fixtures `boundary_project` and `secret_sentinels`, helpers
in `agent_terminus.testing`, and an import-linter contract type
(`agent-terminus[importlinter]`); see [docs/adapters.md](docs/adapters.md).

### Node / TypeScript

```sh
npm i -D github:Lupinixio/agent-terminus#v0.1.0 dependency-cruiser
npx boundaries init
npx boundaries check
npx boundaries lint-rules
```

`dependency-cruiser ^18` is an optional peer, needed when a Node manifest has
`[imports]`. Helpers for vitest/node:test/jest are in `agent-terminus/testing`.

### Claude Code

```sh
npx boundaries init --claude --git-hook --with-ci --owner @your-org/boundary-owners
```

- copies the hook to `.claude/hooks/protect-boundaries.mjs` and registers it in
  `.claude/settings.json` (other entries are kept);
- adds `@.boundaries/rules.md` to `CLAUDE.md`;
- writes `.githooks/pre-commit` and prints `git config core.hooksPath .githooks`;
- writes `.github/workflows/boundaries.yml` and appends the CODEOWNERS block.

Then follow the GitHub settings in
[docs/protecting-checks.md](docs/protecting-checks.md).

### Other tools

- **AGENTS.md**: `boundaries init --agents-md` inlines the rule text between
  markers (AGENTS.md has no imports).
- **Cursor, Windsurf, Copilot**: copy `rules/boundaries.md` into the tool's rules
  folder; `lint-rules` scans the usual locations.
- **Other agent hooks**: import `decide({ toolName, toolInput, cwd })` from
  `agent-terminus/hook` and map `{ decision, reason }` to the tool's format.
- Agent role snippets (planning, implementing, reviewing):
  [rules/agent-snippets.md](rules/agent-snippets.md).

## Commands

| Command | Adapter | Purpose |
|---|---|---|
| `boundaries check` | both | validate, run every check, verify generated files (Node: and the CODEOWNERS block) |
| `boundaries validate` | both | schema, support set and file existence; runs no project code |
| `boundaries generate` | both | write `.boundaries/generated/` |
| `boundaries keys --json` | both | the keys this adapter checks |
| `boundaries lint-rules` | Node | find manifest-owned identifiers restated in rules files |
| `boundaries diff --base <ref>` | Node | a change under `.boundaries/` needs a new decision record |
| `boundaries codeowners` | Node | print the CODEOWNERS block for the protected paths |
| `boundaries init` | Node | set a project up (idempotent; never overwrites without `--update`) |

Exit codes: 0 pass, 1 violations, 2 usage, 3 config, 4 stale generated files or
CODEOWNERS block, 70 internal error. Contract: [docs/adapters.md](docs/adapters.md).

## Distribution

- **Node**: `npm i -D github:Lupinixio/agent-terminus#v0.1.0` (the package is the
  repository root, so no build step), `npm i -D file:../agent-terminus`, or an
  `npm pack` tarball. npm publishing comes later.
- **Python**: `uv add --dev "agent-terminus @ git+https://github.com/Lupinixio/agent-terminus@v0.1.0#subdirectory=python"`,
  or `uv add --dev --editable ../agent-terminus/python`; with pip,
  `pip install "agent-terminus @ git+https://github.com/Lupinixio/agent-terminus@v0.1.0#subdirectory=python"`.
- **Copy only**: `rules/boundaries.md` and `hooks/protect-boundaries.mjs` are
  self-contained single files.
- Both packages share one version and one tag (`vX.Y.Z`).

## Limitations

- **Static analysis only.** Imports and calls are found in source; dynamic
  imports, reflection, `getattr` tricks and code generated at runtime are not.
  Forbid the dynamic forms (`importlib.import_module`, `eval`) under `[calls]`.
- **Providers must be honest.** Entry-point and bind providers must read the
  framework's real registry and settings. That is why every provider file must be
  protected and reviewed.
- **The secret probe sees what it drives.** A leak on a path the probe never
  exercises is not found.
- **The hook is best effort.** A script that writes a protected file without
  naming it gets past tier 1; tiers 2 and 3 catch it.

## Status and licence

v0.1.0. Released under the [MIT licence](LICENSE). Contributions:
[CONTRIBUTING.md](CONTRIBUTING.md).
