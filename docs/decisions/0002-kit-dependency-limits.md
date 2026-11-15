# 0002 Kit dependency limits

Status: accepted (v0.1.0)

## Context

The kit asks projects to keep their dependencies deliberate, so its own code
should do the same, and the limits should be checked by the kit itself rather
than described in prose.

## Decision

The kit's limits are the manifests under `.boundaries/` at the repository root:

- `hook.toml`: the PreToolUse hook is a single file with no dependencies that
  only reads. It can be copied into a project on its own.
- `node-kit.toml`: the Node adapter's runtime dependencies stay minimal, and each
  parser or peer dependency is imported by exactly one module.
- `python-kit.toml`: the Python adapter has no runtime dependencies; the optional
  integrations (import-linter, pytest) are each confined to one module.

`kit.toml` lists the kit-level decision records. Both adapters check these
manifests in CI (`npm run test:cross` runs `boundaries check` on the repository
with each adapter).

## Consequences

- Adding a dependency, or using an existing one from another module, needs a new
  decision record and a manifest change in the same pull request.
- The kit's CLAUDE.md points to `.boundaries/`; it does not restate these limits.
