"""Generated files under ``.boundaries/generated/`` and their freshness check.

The Python adapter owns ``index.json`` only; ``depcruise.cjs`` belongs to the Node adapter.
"""

from __future__ import annotations

from dataclasses import dataclass

from .index_file import INDEX_PATH, build_index
from .manifest import Project


@dataclass(frozen=True)
class Stale:
    file: str
    stale: bool


def generate(project: Project, write: bool) -> list[Stale]:
    """Compares (and with ``write``, rewrites) the generated files."""
    path = project.root / INDEX_PATH
    content = build_index(project)
    current = path.read_bytes().decode("utf-8").replace("\r\n", "\n") if path.exists() else None
    stale = current != content
    if stale and write:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(content.encode("utf-8"))
    return [Stale(INDEX_PATH, stale)]
