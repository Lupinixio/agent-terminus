"""File-system helpers shared by the loader and the checks."""

from __future__ import annotations

import os
from pathlib import Path

from . import glob as globmod

SKIP_DIRS = frozenset(
    {"node_modules", ".git", ".venv", "__pycache__", ".scratch", ".mypy_cache", ".ruff_cache", ".pytest_cache"}
)


def walk_files(root: Path, start: str = "") -> list[str]:
    """Project-relative paths (forward slashes) of all files below ``start``."""
    base = root / start if start else root
    if not base.exists():
        return []
    if base.is_file():
        return [base.relative_to(root).as_posix()]
    out: list[str] = []
    for dirpath, dirnames, filenames in os.walk(base):
        dirnames[:] = sorted(d for d in dirnames if d not in SKIP_DIRS)
        for name in filenames:
            out.append((Path(dirpath) / name).relative_to(root).as_posix())
    return sorted(out)


def glob_files(root: Path, glob: str) -> list[str]:
    """Files matching a glob, searched below the glob's literal directory prefix."""
    prefix = globmod.literal_prefix(glob)
    start = prefix[: prefix.rfind("/")] if "/" in prefix else ""
    return [rel for rel in walk_files(root, start) if globmod.match(glob, rel)]
