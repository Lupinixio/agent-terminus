# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/) (pre-1.0: minor versions may break).

## [Unreleased]

### Changed

- Renamed the project from `boundaries-kit` to **Agent Terminus**: npm package
  and PyPI distribution `agent-terminus`, Python import package `agent_terminus`
  (`python -m agent_terminus`, pytest plugin `agent_terminus`, import-linter
  contract type `agent_terminus.importlinter_contract.BoundaryContract`), schema
  `$id`s `urn:agent-terminus:...`, CODEOWNERS markers `# BEGIN agent-terminus` /
  `# END agent-terminus`, AGENTS.md markers `<!-- agent-terminus:rules:* -->`
  and the version header in `.boundaries/rules.md`. The `.boundaries/` folder,
  manifest file names and the `boundaries` command are unchanged
  (`docs/decisions/0003-rename-to-agent-terminus.md`).
- Licensed under MIT (previously no licence, all rights reserved).

## [0.1.0]

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
