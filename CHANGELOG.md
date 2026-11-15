# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/) (pre-1.0: minor versions may break).

## [Unreleased]

## [0.1.0] - 2026-11-15

First public release, as **Agent Terminus** under the MIT licence (developed
under the working name `boundaries-kit`; see
`docs/decisions/0003-rename-to-agent-terminus.md`).

### Added

- Manifest format (`.boundaries/<component>.toml`, `schema_version = 1`) with
  `component`, `imports`, `calls`, `entrypoints`, `runtime.bind`,
  `runtime.secrets` and `protected`; optional `.boundaries/kit.toml`. JSON schemas
  and a conformance corpus in `schema/`.
- Python adapter (`python/`): zero runtime dependencies, own AST import and call
  scanners, providers and probes, secret-leak detection, `index.json`
  generation, CLI (`check`, `validate`, `generate`, `keys`), test helpers, pytest
  plugin, and an import-linter contract type that delegates to the scanner.
- Node adapter (repository root): dependency-cruiser import check, Babel call
  scan, providers and probes, secret-leak detection, `index.json` and
  `depcruise.cjs` generation, and the shared tooling: `lint-rules`, `diff`,
  `codeowners`, `init`. Test helpers in `agent-terminus/testing`.
- Claude Code `PreToolUse` hook (`hooks/protect-boundaries.mjs`), git pre-commit
  template, CODEOWNERS snippet and GitHub workflow template.
- Rule text (`rules/boundaries.md`) and agent snippets.
- Docs: manifest reference, adapter contract, protecting the checks, a worked
  example (`examples/web-dashboard`).
