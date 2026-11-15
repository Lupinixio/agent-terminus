# Adapters

An adapter checks the manifests of one language. v0.1.1 ships two:

| Adapter | Package | Runtime dependencies | Import check | Call scan |
|---|---|---|---|---|
| `python` | `agent-terminus` (PyPI name, in `python/`), import name `agent_terminus` | none | own AST scanner | own AST scanner |
| `node` | `agent-terminus` (npm, repository root) | `smol-toml`, `@babel/parser`; optional peer `dependency-cruiser ^18` | dependency-cruiser `cruise()` | `@babel/parser` + own visitor |

Shared tooling (`lint-rules`, `diff`, `codeowners`, `init`) is in the Node CLI
only; Python-only projects run it with
`npx --yes --package=github:Lupinixio/agent-terminus#v0.1.1 boundaries <command>`.

## CLI contract

Every adapter implements:

```
boundaries check     [--root .] [--component NAME]... [--format text|json]
boundaries validate  [--root .] [--format text|json]
boundaries generate  [--root .]
boundaries keys      --json
```

- `check`:
  1. validate kit.toml and every manifest (schema and adapter rules);
  2. check the support set (unknown keys or schema versions are exit 3);
  3. run every check for the adapter's own components (`imports`, `calls`,
     `entrypoints`, `runtime.bind`, `runtime.secrets`, `protected`);
  4. verify the generated files are fresh;
  5. (Node) verify the CODEOWNERS marker block, when one exists, covers
     `index.json`'s protected list.
- `validate`: steps 1–2 plus file existence. Runs no project code.
- `generate`: writes `.boundaries/generated/index.json` (both adapters) and
  `.boundaries/generated/depcruise.cjs` (Node, when there are Node components).
- `keys --json`: `{"adapter": "...", "schema_versions": [1], "supported_keys": [...]}`.

Node-only: `lint-rules`, `diff --base <ref>`, `codeowners [--owner @team]`,
`init [...]` (see the README). The Python CLI answers them with exit 2 and a
pointer to `npx boundaries <command>`.

## Exit codes

| Code | Meaning |
|---|---|
| 0 | pass |
| 1 | violations |
| 2 | usage |
| 3 | config: invalid manifest or kit.toml, unsupported key or version, missing provider, peer or file, unparseable source |
| 4 | generated files or the CODEOWNERS block are stale (only when there is no 1 or 3) |
| 70 | internal error |

Precedence: 3 stops the run before any check runs; then 1; then 4.

## JSON report

```json
{
  "schema_version": 1,
  "adapter": "python",
  "results": [
    { "component": "dashboard", "check": "imports", "key": "imports.builtin",
      "location": "src/app/dashboard/app.py:8", "message": "import sqlite3 is not allowed by imports.builtin" }
  ],
  "skipped": [{ "component": "ui", "reason": "language node is checked by its own adapter" }],
  "stale": [".boundaries/generated/index.json"],
  "errors": [{ "file": ".boundaries/ui.toml", "key": "component.name", "message": "..." }]
}
```

- `check` is one of `imports`, `calls`, `entrypoints`, `runtime.bind`,
  `runtime.secrets`, `protected`, `decisions`, `generated`, `codeowners`.
- `location` is `path:line` or `null`.
- Text form: `<component> <check> <location>: <message> [<key>]` per finding,
  then a summary line.

The exit codes, this JSON shape and the rule text in `rules/` are a public
contract: changing them is a breaking change.

## `index.json`

Both adapters must write byte-identical files:

```json
{"schema_version":1,"decision":"ask","protected":[...]}
```

`protected` is sorted and de-duplicated: the built-in list ∪ `kit.toml
protected.paths` ∪ every manifest's `protected.paths`. Sorted keys, 2-space
indent, LF line endings, a trailing newline. Freshness ignores CRLF conversion on
checkout.

## Python extras

- `agent_terminus.testing`: `secret_sentinels(names)` (context manager),
  `assert_no_secret(texts, sentinels)`, `assert_entrypoints(manifest, actual,
  group="http")`, `assert_boundaries_hold(root=".")`. Each raises
  `AssertionError` listing every finding.
- pytest plugin (registered automatically): fixtures `boundary_project` and
  `secret_sentinels` (a factory; restored at teardown).
- import-linter contract type (extra `agent-terminus[importlinter]`):

  ```toml
  [tool.importlinter]
  root_packages = ["orders"]
  contract_types = ["boundaries: agent_terminus.importlinter_contract.BoundaryContract"]

  [[tool.importlinter.contracts]]
  name = "Component boundaries"
  type = "boundaries"
  # manifests = ".boundaries"   (default)
  ```

  It delegates to the same scanner as `boundaries check`, so the two cannot
  disagree, and the import check still runs if someone deletes the contract.

## Node extras

`agent-terminus/testing` (framework-agnostic, throws `node:assert`
`AssertionError`): `assertEntrypoints(manifest, actual, group?)`,
`withSecretSentinels(names, fn)`, `assertNoSecret(texts, sentinels)`,
`checkBoundaries({ root })`. The package root exports `loadProject`,
`validateManifest`, `validateKit`, `check`, `generate`, `toDepcruiseRules`,
`lintRules`, `codeownersBlock`, `SUPPORTED_KEYS`, `SCHEMA_VERSIONS`,
`BUILTIN_PROTECTED` and `VERSION`.

## Adding an adapter

A new adapter must:

1. parse TOML and validate manifests and kit.toml against the schemas, passing
   the corpus in `schema/fixtures/` (each invalid file starts with
   `# expect: <key.path>`, the key the validator must report);
2. declare `SUPPORTED_KEYS` (dotted key paths, arrays of tables as `key[].sub`) and
   `SCHEMA_VERSIONS`;
3. fail with exit 3 on any key or version it does not check, and report other
   languages' manifests as `skipped`;
4. implement the CLI contract, exit codes and JSON shape above;
5. write a byte-identical `index.json` (add its fixtures to the parity test in
   `tools/cross/`);
6. ship passing and violating fixtures that prove every supported key catches a
   violation, and add its column to the matrix in `docs/manifest.md`.

Adding a language is a schema `enum` addition, not a `schema_version` bump.

### Sketch: Kotlin

- `language = "kotlin"`; `component.package` is the Kotlin package.
- `imports`: a Konsist or ArchUnit test, or a Gradle task, that reads the manifest
  and asserts the allow lists (internal = packages, external = Maven group or
  package prefixes, builtin = `java.*`/`kotlin.*` prefixes).
- `calls`: the same pattern grammar over resolved call names (Konsist or a PSI
  visitor).
- `entrypoints`, `runtime`: providers as `fully.qualified.Class#method` would need
  a new `ref` form in the schema (a minor, additive change).
- The CLI can be a Gradle plugin task `boundariesCheck` with the same exit codes
  and JSON output.
