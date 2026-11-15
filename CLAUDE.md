# agent-terminus

A toolkit other developers drop into Python and Node/TypeScript repositories:
hard limits as checked manifests, AI rules as principles only. Everything outside
`CLAUDE.md` and `.claude/` is shared publicly and stays generic: no personal
names, absolute paths or references to other projects (use placeholders such as
`<owner>`).

Stack: Node `^22.18.0 || >=24.11.0` (plain ES modules with JSDoc types, checked by
`tsc` 6; ESLint; `node:test`), Python `>=3.11` (stdlib only at runtime; uv,
`uv_build`, ruff, mypy strict, pytest).

## Boundaries

@rules/boundaries.md

The kit's own limits are in `.boundaries/` (decisions in `docs/decisions/`).

## Conventions

- Folder roles:
  - `schema/`: canonical JSON schemas, the built-in protected list, the
    conformance corpus (`fixtures/manifest`, `fixtures/kit`) and shared glob cases;
  - `rules/`: the rule text and agent snippets (public contract);
  - `hooks/`: the PreToolUse hook (zero dependencies) and the pre-commit template;
  - `templates/`: CODEOWNERS snippet and the GitHub workflow template;
  - `node/`: the Node adapter and shared tooling (`bin/`, `src/`, `test/`); the npm
    package is the repository root;
  - `python/`: the Python adapter (`src/agent_terminus`, `tests/`);
  - `fixtures/<language>/{passing,violating}`: end-to-end projects for each adapter;
  - `examples/`: worked examples for users;
  - `tools/cross/`: tests that need both environments;
  - `docs/`: reference docs and decision records.
- Per adapter, a pure core (model, validator, glob, rule generation, scanners) with
  no environment, process or clock access. I/O only in cli, refs, runtime,
  generate, init and diff; the process environment only in `env.js` / `env.py`.
- Checks return violations; only the CLI picks exit codes.
- `schema/` is canonical; both hand-written validators must pass the corpus.
- Adding a key means, in one change: schema + both validators + `SUPPORTED_KEYS`
  + the check + a violating fixture + the matrix in `docs/manifest.md` + CHANGELOG.
- Fail loudly: anything an adapter cannot check is exit 3, never a skip.
- `index.json` must stay byte-identical from both adapters (cross-tested).
- Exit codes, the JSON report and the rule text are a public contract.
- Pre-1.0 semver; one version for both packages (package.json, `version.js`,
  `agent_terminus.__version__`, `pyproject.toml`, the hook's `KIT_VERSION`).
- Temp files go under `.scratch/` (git-ignored).

## Docs that change with code

- A key or its semantics → `schema/`, `docs/manifest.md`, CHANGELOG.
- CLI, exit codes or JSON → `docs/adapters.md`, README.
- `rules/` or `templates/` → CHANGELOG.
- Hook or protection behaviour → `docs/protecting-checks.md`.
- Every user-visible change → CHANGELOG "Unreleased".

## Checks

```
npm ci && uv sync --project python --locked
npm run lint            # eslint .
npm run typecheck       # tsc --noEmit -p .
npm test                # node --test --test-reporter=dot node/test
uv run --project python ruff check python && uv run --project python ruff format --check python
uv run --directory python mypy          # strict, python_version = 3.11
uv run --project python pytest -q python/tests
npm run test:cross      # node --test tools/cross (parity, keys, docs matrix, dogfood)
```

## Worktrees

Every change happens in its own git worktree, never directly on `main`. There is
no remote yet, so branch from local `main`:

```
git worktree add -b feature/<slug> .claude/worktrees/<slug> main
cd .claude/worktrees/<slug>
npm ci && uv sync --project python --locked
```

Work, run the checks and commit inside the worktree. Merge to `main` only after
the tester passes and the owner approves; then remove the worktree
(`git worktree remove .claude/worktrees/<slug>`) and delete the branch.

## Agent workflow

| Step | Agent | When |
|---|---|---|
| Plan | `architect` | multi-file features, format or CLI changes |
| Build | `dev` | every code change, in a worktree |
| Test | `tester` | after every `dev` run; runs all checks above |
| Compliance | — | not used (no compliance triggers in this project) |
| Design | — | not used (no UI) |

Routing: changes to `hooks/`, to any check's semantics, or to `validate`/`support`
run `dev` on Opus, and the tester runs both fixture suites plus `npm run test:cross`.
