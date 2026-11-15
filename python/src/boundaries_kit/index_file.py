"""``.boundaries/generated/index.json``: the hook's input. Pure; byte-identical to
the Node adapter's output (cross-tested)."""

from __future__ import annotations

import json
from typing import TYPE_CHECKING, Any

from .support import BUILTIN_PROTECTED

if TYPE_CHECKING:
    from .manifest import Project

INDEX_PATH = ".boundaries/generated/index.json"


def canonical_json(value: Any) -> str:
    """Sorted keys, 2-space indent, LF and a trailing newline."""
    return json.dumps(value, indent=2, sort_keys=True, ensure_ascii=False) + "\n"


def protected_globs(project: Project) -> list[str]:
    """Sorted, de-duplicated protected globs: built-ins, kit.toml, every manifest."""
    globs = set(BUILTIN_PROTECTED) | set(project.kit.protected)
    for m in project.manifests:
        globs |= set(m.protected)
    return sorted(globs)


def build_index(project: Project) -> str:
    return canonical_json(
        {"schema_version": 1, "decision": project.kit.hook_decision, "protected": protected_globs(project)}
    )
