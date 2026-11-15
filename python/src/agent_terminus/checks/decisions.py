"""Decision records linked from a manifest or kit.toml must exist.

A missing record is a config error (exit 3), reported while loading the project.
"""

from __future__ import annotations

from collections.abc import Iterable
from pathlib import Path

from ..validate import Problem


def decision_problems(root: Path, decisions: Iterable[str], file: str, key: str) -> list[Problem]:
    return [
        Problem(file, f"{key}[{i}]", f"decision file {d} does not exist")
        for i, d in enumerate(decisions)
        if not (root / d).exists()
    ]
