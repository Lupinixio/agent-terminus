"""[[entrypoints]]: the provider's set must equal ``exact``. Runs project code."""

from __future__ import annotations

import asyncio
import inspect
import re
from collections.abc import Callable, Iterable
from typing import Any

from ..manifest import Manifest, Project
from ..refs import load_ref
from ..report import Violation
from . import ConfigError


def normalize_entry(entry: str) -> str:
    return re.sub(r"\s+", " ", entry.strip())


def call_ref(fn: Callable[..., Any]) -> Any:
    """Calls a provider or probe; awaits it when it returns an awaitable."""
    value = fn()
    if inspect.isawaitable(value):

        async def wait() -> Any:
            return await value

        value = asyncio.run(wait())
    return value


def resolve(project: Project, manifest: Manifest, ref: str, key: str) -> Callable[..., Any]:
    try:
        return load_ref(ref, project.root, project.kit.python_sys_path)
    except LookupError as error:
        raise ConfigError(manifest.file, key, str(error)) from error


def call_provider(project: Project, manifest: Manifest, ref: str, key: str) -> list[str]:
    """Calls a provider and returns its strings, or raises ConfigError."""
    fn = resolve(project, manifest, ref, key)
    try:
        value = call_ref(fn)
    except Exception as error:
        raise ConfigError(manifest.file, key, f"provider {ref} failed: {error}") from error
    if isinstance(value, (str, bytes)) or not isinstance(value, Iterable):
        raise ConfigError(manifest.file, key, f"provider {ref} must return an iterable of strings")
    items = list(value)
    if not all(isinstance(i, str) for i in items):
        raise ConfigError(manifest.file, key, f"provider {ref} must return an iterable of strings")
    return items


def compare_entrypoints(declared: Iterable[str], actual: Iterable[str]) -> tuple[list[str], list[str]]:
    """(missing, extra) between a declared and an actual set."""
    want = {normalize_entry(e) for e in declared}
    have = {normalize_entry(e) for e in actual}
    return sorted(want - have), sorted(have - want)


def check_entrypoints(project: Project, manifest: Manifest) -> list[Violation]:
    out: list[Violation] = []
    for index, group in enumerate(manifest.entrypoints):
        key = f"entrypoints[{index}].exact"
        actual = call_provider(project, manifest, group.provider, f"entrypoints[{index}].provider")
        missing, extra = compare_entrypoints(group.exact, actual)
        name = manifest.component.name
        out += [
            Violation(name, "entrypoints", key, None, f'{group.name}: "{e}" is exposed but not declared') for e in extra
        ]
        out += [
            Violation(name, "entrypoints", key, None, f'{group.name}: "{e}" is declared but not exposed')
            for e in missing
        ]
    return out
