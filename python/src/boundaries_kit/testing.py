"""Test helpers for projects that use the kit (pytest, unittest...).

Every failure raises ``AssertionError`` listing all findings. These are extras on top
of ``boundaries check``, not substitutes for it.
"""

from __future__ import annotations

from collections.abc import Iterable, Iterator, Mapping
from contextlib import contextmanager
from pathlib import Path

from .check import check
from .checks.entrypoints import compare_entrypoints
from .env import plant_env
from .manifest import Manifest, load_project
from .report import exit_code, render_text
from .sentinels import find_leaks, make_sentinel


@contextmanager
def secret_sentinels(names: Iterable[str]) -> Iterator[dict[str, str]]:
    """Plants a fresh sentinel per name in the process environment while the block runs."""
    sentinels = {name: make_sentinel() for name in names}
    restore = plant_env(sentinels)
    try:
        yield sentinels
    finally:
        restore()


def assert_no_secret(texts: Iterable[str], sentinels: Mapping[str, str]) -> None:
    """Asserts that no sentinel (in any searched encoding) appears in the texts."""
    leaks = find_leaks(((f"text #{i}", t) for i, t in enumerate(texts)), sentinels)
    if leaks:
        raise AssertionError(
            "secrets leaked:\n" + "\n".join(f"{leak.name} in {leak.source} ({leak.form})" for leak in leaks)
        )


def assert_entrypoints(manifest: Manifest | str, actual: Iterable[str], group: str = "http") -> None:
    """Asserts that ``actual`` equals a manifest's entrypoint group exactly.

    ``manifest`` is a loaded manifest or a component name (loaded from the working directory).
    """
    if isinstance(manifest, str):
        project = load_project(Path.cwd())
        found = next((m for m in project.manifests if m.component.name == manifest), None)
        if found is None:
            raise AssertionError(f"no manifest for component {manifest} under {project.root / '.boundaries'}")
        manifest = found
    g = next((x for x in manifest.entrypoints if x.name == group), None)
    if g is None:
        raise AssertionError(f'{manifest.file} has no entrypoint group "{group}"')
    missing, extra = compare_entrypoints(g.exact, actual)
    problems = [f"exposed but not declared: {e}" for e in extra] + [f"declared but not exposed: {e}" for e in missing]
    if problems:
        raise AssertionError(f'entrypoints "{group}" of {manifest.component.name} differ:\n' + "\n".join(problems))


def assert_boundaries_hold(root: Path | str = ".") -> None:
    """Runs the full Python check; raises AssertionError with the report unless it passes."""
    result = check(root)
    if exit_code(result.report) != 0:
        raise AssertionError(render_text(result.report, result.checked))
