# Contributing

Thanks for helping. The kit is small on purpose; please open an issue before a
large change.

## Setup

Node `^22.18.0 || >=24.11.0` and [uv](https://docs.astral.sh/uv/) (Python 3.11+):

```sh
npm ci
uv sync --project python --locked
```

## Checks

All of these must pass before a pull request is merged (CI runs them on Linux and
Windows, Node 22.18 and 24, Python 3.11 and 3.13):

```sh
npm run lint
npm run typecheck
npm test
uv run --project python ruff check python
uv run --project python ruff format --check python
uv run --directory python mypy
uv run --project python pytest -q python/tests
npm run test:cross      # needs both environments: parity, keys, docs matrix, dogfood
```

## Changing the format

The schema in `schema/` is canonical. Adding or changing a manifest key is one
change that updates, together: the schema, both validators, `SUPPORTED_KEYS`, the
check, a violating fixture, the matrix in `docs/manifest.md` and `CHANGELOG.md`.
The exit codes, the JSON report and the rule text in `rules/` are a public
contract.

## Adding an adapter

See [docs/adapters.md](docs/adapters.md#adding-an-adapter).

## The kit's own limits

The kit checks itself: see `.boundaries/` and `docs/decisions/`. Changing a
manifest there needs a new decision record.
