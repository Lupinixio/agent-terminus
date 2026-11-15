"""Resolves ``module:attribute`` references to callables (imports project code)."""

from __future__ import annotations

import importlib
import importlib.util
import sys
from collections.abc import Callable, Iterable
from pathlib import Path
from typing import Any


def search_path(root: Path, sys_path: Iterable[str]) -> list[Path]:
    """``kit.python.sys_path`` entries (project-relative) followed by the root."""
    return [(root / p).resolve() for p in sys_path] + [root.resolve()]


def _activate(paths: list[Path]) -> None:
    for p in reversed(paths):
        text = str(p)
        if text in sys.path:
            sys.path.remove(text)
        sys.path.insert(0, text)
    importlib.invalidate_caches()


def _purge_foreign(top: str, paths: list[Path]) -> None:
    """Forget modules of the same top-level name loaded from another location
    (for example an earlier project in the same process)."""
    for name in [n for n in sys.modules if n == top or n.startswith(top + ".")]:
        origin = getattr(sys.modules[name], "__file__", None)
        if origin is None or not any(Path(origin).resolve().is_relative_to(p) for p in paths):
            del sys.modules[name]


def module_file(module: str, root: Path, sys_path: Iterable[str]) -> Path | None:
    """The source file of a module, found on the search path without importing it."""
    parts = module.split(".")
    for base in search_path(root, sys_path):
        for candidate in (base.joinpath(*parts).with_suffix(".py"), base.joinpath(*parts, "__init__.py")):
            if candidate.is_file():
                return candidate
    paths = search_path(root, sys_path)
    _activate(paths)
    try:
        spec = importlib.util.find_spec(module)
    except (ImportError, ValueError):
        return None
    if spec is None or spec.origin is None or spec.origin in ("built-in", "frozen"):
        return None
    return Path(spec.origin)


def load_ref(ref: str, root: Path, sys_path: Iterable[str] = ()) -> Callable[..., Any]:
    """Imports ``module`` and returns ``attribute``; raises LookupError with a readable message."""
    module, _, attr = ref.partition(":")
    paths = search_path(root, sys_path)
    _activate(paths)
    _purge_foreign(module.split(".")[0], paths)
    try:
        mod = importlib.import_module(module)
    except Exception as error:
        raise LookupError(f"{ref}: cannot import {module}: {error}") from error
    fn: object = getattr(mod, attr, None)
    if not callable(fn):
        raise LookupError(f"{ref}: {module} has no callable {attr}")
    return fn
