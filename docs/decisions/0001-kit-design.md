# 0001 Kit design

Status: accepted (v0.1.0)

## Context

Rules files for AI coding agents (CLAUDE.md, AGENTS.md, Cursor rules...) mix two
kinds of text: principles ("prefer enforcement on the receiving side") and hard
limits ("the dashboard must not import the engine", "bind to 127.0.0.1 only").
Agents follow prose unreliably, and prose drifts from the code. Hard limits need
to be checked by code, and the checks need to be hard to weaken quietly.

## Decision

- **Three layers.** Principles stay in `rules/boundaries.md`. Limits live in
  `.boundaries/<component>.toml` manifests and are checked by `boundaries check`.
  The checks are protected in three tiers: an agent hook that asks before edits,
  a git pre-commit hook, and CODEOWNERS plus branch protection with the CI job
  required. Only the last tier cannot be bypassed locally.
- **Single source of truth.** Checks read the manifests when they run. The only
  generated files are `.boundaries/generated/index.json` (the hook's input) and
  `.boundaries/generated/depcruise.cjs` (optional for consumers). Both are
  verified fresh; a stale file is exit 4.
- **One canonical schema, one adapter per language.** `schema/` is canonical.
  Each adapter has a hand-written validator held to the schema by the
  conformance corpus in `schema/fixtures/` (ajv and jsonschema are dev-only), and
  declares `SUPPORTED_KEYS`. A key an adapter does not check is exit 3, never a
  silent pass.
- **Pairing rule.** Every declared limit must be verifiable by `boundaries check`
  itself, so `entrypoints.exact` needs a provider, `runtime.secrets` a probe and
  `runtime.bind` a provider. Every provider and probe file must be covered by
  `protected.paths`. Every manifest links at least one decision record.
- **Exit codes** 0 pass, 1 violations, 2 usage, 3 config, 4 stale, 70 internal,
  and the JSON report shape in `docs/adapters.md`, are a public contract.
- **Python adapter:** zero runtime dependencies (stdlib `tomllib` and `ast`), its
  own AST import scanner. The import-linter contract type delegates to that
  scanner, so `lint-imports` and `boundaries check` cannot disagree.
- **Node adapter:** `smol-toml` for TOML, `@babel/parser` with a small visitor for
  the call scan, and dependency-cruiser (optional peer) through its in-memory
  `cruise()` API for imports. TypeScript 7 has no classic parse API, so it is not
  used as a parser.
- **TypeScript for type-checking the kit is pinned to `^6`.** dependency-cruiser
  18 supports `typescript >=2 <7` for analysing `.ts` sources, and the kit's own
  tests cruise a `.ts` fixture.
- **Node `>=22.18`.** dependency-cruiser 18 and @babel/parser 8 need it; Node 20 is
  end of life.
- **Distribution:** the npm package is the repository root (installable from git
  with no build step); the Python package lives in `python/`. Both share one
  version.

## Consequences

- Adding a manifest key means schema, both validators, `SUPPORTED_KEYS`, a check,
  a violating fixture, the docs matrix and the CHANGELOG in one change.
- A third adapter only has to meet `docs/adapters.md`; the cross tests in
  `tools/cross/` hold adapters to the same keys, index bytes and versions.
- Static analysis has limits (dynamic imports, reflection); providers must read
  the framework's real registry. Both are documented in the README.
