"""[runtime]: bind hosts and secret leaks. Runs project code."""

from __future__ import annotations

import io
import logging
from collections.abc import Callable, Iterable, Iterator
from contextlib import contextmanager, redirect_stderr, redirect_stdout
from dataclasses import dataclass
from typing import Any

from ..env import plant_env
from ..manifest import Manifest, Project
from ..report import Violation
from ..sentinels import find_leaks, make_sentinel
from . import ConfigError
from .entrypoints import call_provider, call_ref, resolve


def check_bind(project: Project, manifest: Manifest) -> list[Violation]:
    if manifest.bind is None:
        return []
    actual = call_provider(project, manifest, manifest.bind.provider, "runtime.bind.provider")
    name = manifest.component.name
    if not actual:
        return [
            Violation(
                name, "runtime.bind", "runtime.bind.hosts", None, f"provider {manifest.bind.provider} returned no host"
            )
        ]
    return [
        Violation(name, "runtime.bind", "runtime.bind.hosts", None, f"binds to {h}, which is not in runtime.bind.hosts")
        for h in actual
        if h not in manifest.bind.hosts
    ]


@dataclass
class Captured:
    stdout: str = ""
    stderr: str = ""
    logs: str = ""


@contextmanager
def capture_output() -> Iterator[Captured]:
    """Captures stdout, stderr and every record reaching the root logger."""
    result = Captured()
    out, err, logs = io.StringIO(), io.StringIO(), io.StringIO()
    handler = logging.StreamHandler(logs)
    handler.setLevel(logging.DEBUG)
    handler.setFormatter(logging.Formatter("%(levelname)s %(name)s %(message)s"))
    root = logging.getLogger()
    previous_level = root.level
    root.addHandler(handler)
    root.setLevel(logging.DEBUG)
    try:
        with redirect_stdout(out), redirect_stderr(err):
            yield result
    finally:
        root.removeHandler(handler)
        root.setLevel(previous_level)
        result.stdout, result.stderr, result.logs = out.getvalue(), err.getvalue(), logs.getvalue()


def probe_texts(value: Any) -> list[str]:
    """The strings a probe returned (None, a string, or an iterable of anything)."""
    if value is None:
        return []
    if isinstance(value, str):
        return [value]
    if isinstance(value, bytes):
        return [value.decode("utf-8", "replace")]
    if isinstance(value, Iterable):
        return [v if isinstance(v, str) else repr(v) for v in value]
    return [repr(value)]


def run_probe(fn: Callable[..., Any], sentinels: dict[str, str]) -> list[tuple[str, str]]:
    """Runs a probe with the sentinels planted and output captured; returns (source, text) pairs."""
    restore = plant_env(sentinels)
    try:
        with capture_output() as captured:
            value = call_ref(fn)
    finally:
        restore()
    return [
        *(("probe return value", t) for t in probe_texts(value)),
        ("stdout", captured.stdout),
        ("stderr", captured.stderr),
        ("logging", captured.logs),
    ]


def check_secrets(project: Project, manifest: Manifest) -> list[Violation]:
    """Plants a sentinel per secret name, runs the probe and reports every leak."""
    if manifest.secrets is None:
        return []
    probe = manifest.secrets.probe
    fn = resolve(project, manifest, probe, "runtime.secrets.probe")
    sentinels = {n: make_sentinel() for n in manifest.secrets.names}
    try:
        texts = run_probe(fn, sentinels)
    except Exception as error:
        raise ConfigError(manifest.file, "runtime.secrets.probe", f"probe {probe} failed: {error}") from error
    return [
        Violation(
            manifest.component.name,
            "runtime.secrets",
            "runtime.secrets.names",
            None,
            f"secret {leak.name} leaked in {leak.source} ({leak.form})",
        )
        for leak in find_leaks(texts, sentinels)
    ]
