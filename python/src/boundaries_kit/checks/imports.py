"""[imports]: the adapter's own AST import scanner. Pure apart from reading sources.

Every ``import`` and ``from ... import`` in the component counts, including imports
under ``if TYPE_CHECKING:`` and inside functions (strict). Relative imports are
resolved against the importing module.

Classification by top-level name:

- internal: the top of ``component.package`` and the tops of the internal targets;
- builtin: ``sys.stdlib_module_names``;
- external: everything else.

An allow entry covers the module itself and its descendants. ``from X import n``
passes when ``X.n`` or ``X`` is allowed. The component itself is always allowed.
``from __future__ import ...`` is a compiler directive, not a dependency, and is
never reported.
"""

from __future__ import annotations

import ast
import sys
from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path

from .. import glob as globmod
from ..files import walk_files
from ..manifest import AllowEntry, AllowKind, AllowList, Manifest, Project
from ..report import Violation
from . import ConfigError

STDLIB: frozenset[str] = frozenset(sys.stdlib_module_names)


@dataclass(frozen=True)
class FoundImport:
    """One imported name: ``candidates`` are the dotted names that may allow it."""

    candidates: tuple[str, ...]
    line: int
    text: str

    @property
    def shown(self) -> str:
        return self.candidates[0]


def covers(entry: str, name: str) -> bool:
    """Prefix semantics: an entry covers itself and its descendants."""
    return name == entry or name.startswith(entry + ".")


def module_name(package: str, relpath: str) -> tuple[str, bool]:
    """Dotted module name of a file below the component root, and whether it is a package."""
    parts = relpath[: -len(".py")].split("/") if relpath else []
    is_package = bool(parts) and parts[-1] == "__init__"
    if is_package:
        parts = parts[:-1]
    return ".".join([package, *parts]), is_package


def resolve_relative(module: str, is_package: bool, level: int, target: str | None) -> str | None:
    parts = module.split(".")
    base = parts if is_package else parts[:-1]
    if level - 1 > len(base) - 1:
        return None
    base = base[: len(base) - (level - 1)]
    return ".".join([*base, *([target] if target else [])]) or None


def find_imports(code: str, module: str, is_package: bool, filename: str = "<source>") -> Iterator[FoundImport]:
    """Every import in a source text. Raises SyntaxError or ValueError (bad relative import)."""
    tree = ast.parse(code, filename=filename)
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                yield FoundImport((alias.name,), node.lineno, f"import {alias.name}")
        elif isinstance(node, ast.ImportFrom):
            if node.level:
                base = resolve_relative(module, is_package, node.level, node.module)
                if base is None:
                    raise ValueError(f"line {node.lineno}: relative import goes beyond the top-level package")
            else:
                base = node.module or ""
            if base == "__future__":
                continue
            for alias in node.names:
                if alias.name == "*":
                    yield FoundImport((base,), node.lineno, f"from {base} import *")
                else:
                    yield FoundImport((f"{base}.{alias.name}", base), node.lineno, f"from {base} import {alias.name}")


def internal_roots(manifest: Manifest) -> frozenset[str]:
    roots = {(manifest.component.package or "").split(".")[0]}
    if manifest.imports and manifest.imports.internal != "any":
        roots |= {e.target.split(".")[0] for e in manifest.imports.internal}
    return frozenset(r for r in roots if r)


def classify(name: str, roots: frozenset[str]) -> AllowKind:
    top = name.split(".")[0]
    if top in roots:
        return "internal"
    if top in STDLIB:
        return "builtin"
    return "external"


def _matching_entry(entries: tuple[AllowEntry, ...], candidates: tuple[str, ...]) -> AllowEntry | None:
    for entry in entries:
        if any(covers(entry.target, c) for c in candidates):
            return entry
    return None


def judge(found: FoundImport, importer: str, manifest: Manifest, roots: frozenset[str]) -> tuple[AllowKind, str] | None:
    """None when the import is allowed; otherwise (kind, message)."""
    assert manifest.imports is not None
    package = manifest.component.package or ""
    kind = classify(found.shown, roots)
    if kind == "internal" and package and any(covers(package, c) for c in found.candidates):
        return None
    allowed: AllowList = manifest.imports.of(kind)
    if allowed == "any":
        return None
    entry = _matching_entry(allowed, found.candidates)
    if entry is None:
        return kind, f"{found.text} is not allowed by imports.{kind}"
    if entry.only_from is not None and not any(covers(origin, importer) for origin in entry.only_from):
        return kind, (f"{found.text}: imports.{kind} allows {entry.target} only from {', '.join(entry.only_from)}")
    return None


def component_sources(project: Project, manifest: Manifest) -> list[str]:
    """Project-relative ``.py`` files of a component, minus ``exclude``."""
    return [
        f
        for f in walk_files(project.root, manifest.component.root)
        if f.endswith(".py") and not any(globmod.match(g, f) for g in manifest.component.exclude)
    ]


def read_source(project: Project, file: str, check: str) -> str:
    try:
        return (project.root / file).read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError) as error:
        raise ConfigError(file, check, f"cannot read {file}: {error}") from error


def check_imports(project: Project, manifest: Manifest) -> list[Violation]:
    if manifest.imports is None:
        return []
    roots = internal_roots(manifest)
    base = manifest.component.root
    out: list[Violation] = []
    for file in component_sources(project, manifest):
        rel = Path(file).relative_to(Path(base)).as_posix() if base not in ("", ".") else file
        importer, is_package = module_name(manifest.component.package or "", rel)
        code = read_source(project, file, "imports")
        try:
            found = list(find_imports(code, importer, is_package, file))
        except (SyntaxError, ValueError) as error:
            raise ConfigError(file, "imports", f"cannot parse {file}: {error}") from error
        seen: set[tuple[int, str]] = set()
        for item in found:
            verdict = judge(item, importer, manifest, roots)
            if verdict is None or (item.line, item.shown) in seen:
                continue
            seen.add((item.line, item.shown))
            kind, message = verdict
            out.append(Violation(manifest.component.name, "imports", f"imports.{kind}", f"{file}:{item.line}", message))
    return out
