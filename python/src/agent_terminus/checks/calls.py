"""[calls]: forbidden calls, found with an AST scan. Pure apart from reading sources.

Call names are resolved through import bindings: ``import subprocess as sp; sp.run()``
is ``subprocess.run``; ``from os import system as s; s()`` is ``os.system``. Bare
names count only when no import binds them. ``builtins.open`` is ``open``. Same
pattern semantics as the Node adapter: per-segment ``*`` wildcards, and ``*.attr``
matches any attribute call ending in ``attr``.
"""

from __future__ import annotations

import ast
from dataclasses import dataclass
from fnmatch import fnmatchcase
from pathlib import Path

from ..manifest import Manifest, Project
from ..report import Violation
from . import ConfigError
from .imports import component_sources, module_name, read_source, resolve_relative


@dataclass(frozen=True)
class FoundCall:
    segments: tuple[str, ...]
    known: bool
    line: int

    @property
    def name(self) -> str:
        return ".".join(self.segments)


def match_call(pattern: str, segments: tuple[str, ...], known: bool) -> bool:
    """Whether a resolved call matches a pattern (same semantics as the Node adapter)."""
    if pattern.startswith("*."):
        rest = pattern[2:].split(".")
        if len(segments) <= len(rest):
            return False
        tail = segments[len(segments) - len(rest) :]
        return all(fnmatchcase(s, p) for p, s in zip(rest, tail, strict=True))
    if not known:
        return False
    parts = pattern.split(".")
    return len(parts) == len(segments) and all(fnmatchcase(s, p) for p, s in zip(parts, segments, strict=True))


def collect_bindings(tree: ast.AST, module: str, is_package: bool) -> dict[str, str]:
    """Import bindings of a module: local name -> dotted target."""
    bindings: dict[str, str] = {}
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                if alias.asname:
                    bindings[alias.asname] = alias.name
                else:
                    top = alias.name.split(".")[0]
                    bindings[top] = top
        elif isinstance(node, ast.ImportFrom):
            base = (resolve_relative(module, is_package, node.level, node.module) if node.level else node.module) or ""
            for alias in node.names:
                if alias.name != "*":
                    bindings[alias.asname or alias.name] = f"{base}.{alias.name}" if base else alias.name
    return bindings


def _resolve(node: ast.expr, bindings: dict[str, str]) -> tuple[tuple[str, ...], bool]:
    if isinstance(node, ast.Name):
        return tuple(bindings.get(node.id, node.id).split(".")), True
    if isinstance(node, ast.Attribute):
        segments, known = _resolve(node.value, bindings)
        return (*segments, node.attr), known
    return ("<expression>",), False


def find_calls(
    code: str, module: str = "__main__", is_package: bool = False, filename: str = "<source>"
) -> list[FoundCall]:
    """Every call in a source text (raises SyntaxError)."""
    tree = ast.parse(code, filename=filename)
    bindings = collect_bindings(tree, module, is_package)
    calls = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Call):
            segments, known = _resolve(node.func, bindings)
            if known and len(segments) == 2 and segments[0] == "builtins":
                segments = segments[1:]
            calls.append(FoundCall(segments, known, node.lineno))
    return sorted(calls, key=lambda c: c.line)


def check_calls(project: Project, manifest: Manifest) -> list[Violation]:
    if not manifest.calls:
        return []
    base = manifest.component.root
    out: list[Violation] = []
    for file in component_sources(project, manifest):
        rel = Path(file).relative_to(Path(base)).as_posix() if base not in ("", ".") else file
        module, is_package = module_name(manifest.component.package or "", rel)
        code = read_source(project, file, "calls")
        try:
            calls = find_calls(code, module, is_package, file)
        except SyntaxError as error:
            raise ConfigError(file, "calls", f"cannot parse {file}: {error}") from error
        for call in calls:
            hit = next((p for p in manifest.calls if match_call(p.pattern, call.segments, call.known)), None)
            if hit is None:
                continue
            reason = f" ({hit.reason})" if hit.reason else ""
            out.append(
                Violation(
                    manifest.component.name,
                    "calls",
                    "calls.forbidden",
                    f"{file}:{call.line}",
                    f"call to {call.name} matches forbidden pattern {hit.pattern}{reason}",
                )
            )
    return out
