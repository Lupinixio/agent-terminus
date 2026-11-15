"""[protected]: every provider and probe file must itself be protected, so an agent
cannot quietly edit the code that reports what a component exposes.

(Existence of protected paths is a config rule, checked when loading.)
"""

from __future__ import annotations

import sys
from pathlib import Path

from .. import glob as globmod
from ..index_file import protected_globs
from ..manifest import Manifest, Project
from ..refs import module_file
from ..report import Violation
from . import ConfigError


def provider_refs(manifest: Manifest) -> list[tuple[str, str]]:
    """(key, ref) of every provider and probe of a manifest."""
    refs = [(f"entrypoints[{i}].provider", g.provider) for i, g in enumerate(manifest.entrypoints)]
    if manifest.bind:
        refs.append(("runtime.bind.provider", manifest.bind.provider))
    if manifest.secrets:
        refs.append(("runtime.secrets.probe", manifest.secrets.probe))
    return refs


def check_protected(project: Project, manifest: Manifest) -> list[Violation]:
    globs = protected_globs(project)
    nocase = sys.platform == "win32"
    out: list[Violation] = []
    seen: set[str] = set()
    root = project.root.resolve()
    for key, ref in provider_refs(manifest):
        module = ref.partition(":")[0]
        path = module_file(module, project.root, project.kit.python_sys_path)
        if path is None:
            raise ConfigError(manifest.file, key, f"{ref}: cannot find module {module}")
        resolved = Path(path).resolve()
        if not resolved.is_relative_to(root):
            message = f"{resolved} (from {key}) is outside the project, so it cannot be protected"
            out.append(Violation(manifest.component.name, "protected", "protected.paths", None, message))
            continue
        file = resolved.relative_to(root).as_posix()
        if file in seen:
            continue
        seen.add(file)
        if not any(globmod.match(g, file, nocase=nocase) for g in globs):
            out.append(
                Violation(
                    manifest.component.name,
                    "protected",
                    "protected.paths",
                    None,
                    f"{file} (from {key}) is not covered by protected.paths",
                )
            )
    return out
