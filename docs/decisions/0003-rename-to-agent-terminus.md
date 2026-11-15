# 0003 Rename to Agent Terminus

Status: accepted (Unreleased)

## Context

The kit is being published as a public repository under an open-source licence.
The working name `boundaries-kit` described the folder it manages rather than the
project, and the Python import package `boundaries_kit` is named in the kit's own
manifest (`python-kit.toml`).

## Decision

The project is called Agent Terminus, after Terminus, the Roman god of
boundaries. The npm package and the PyPI distribution are `agent-terminus`; the
Python import package is `agent_terminus`. `python-kit.toml` now names
`python/src/agent_terminus` and `agent_terminus`; its limits (no runtime
dependencies, each optional integration in one module) are unchanged.

What a project's files are called stays the same: the `.boundaries/` folder,
manifest file names including `kit.toml`, and the `boundaries` command.

The kit is licensed under MIT.

## Consequences

- Markers written into user files (`# BEGIN agent-terminus`,
  `<!-- agent-terminus:rules:start -->`) and the schema `$id`s change; nothing
  was published under the old name, so no compatibility shim is kept.
