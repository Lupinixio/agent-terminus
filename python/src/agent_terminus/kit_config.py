"""``.boundaries/kit.toml``: optional project configuration (not limits)."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class KitConfig:
    file: str | None = None
    decisions: tuple[str, ...] = ()
    rules_lint_files: tuple[str, ...] | None = None
    rules_lint_allow: tuple[str, ...] = ()
    protected: tuple[str, ...] = ()
    hook_decision: str = "ask"
    python_sys_path: tuple[str, ...] = ()
    node_tsconfig: str | None = None


def kit_from_raw(raw: dict[str, Any], file: str) -> KitConfig:
    """Builds a KitConfig from an already validated raw table."""
    lint = raw.get("rules_lint", {})
    files = lint.get("files")
    return KitConfig(
        file=file,
        decisions=tuple(raw.get("decisions", ())),
        rules_lint_files=tuple(files) if files is not None else None,
        rules_lint_allow=tuple(lint.get("allow", ())),
        protected=tuple(raw.get("protected", {}).get("paths", ())),
        hook_decision=raw.get("hook", {}).get("decision", "ask"),
        python_sys_path=tuple(raw.get("python", {}).get("sys_path", ())),
        node_tsconfig=raw.get("node", {}).get("tsconfig"),
    )
