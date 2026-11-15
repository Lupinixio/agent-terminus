"""Shared helpers. Temp dirs live under <repo>/.scratch/pytest (git-ignored)."""

from __future__ import annotations

import shutil
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[2]
FIXTURES = REPO / "fixtures" / "python"

DECISION = "docs/decisions/0001-boundaries.md"


def pytest_configure(config: pytest.Config) -> None:
    if not config.option.basetemp:
        config.option.basetemp = str(REPO / ".scratch" / "pytest")


def write_files(root: Path, files: dict[str, str]) -> Path:
    for rel, content in files.items():
        path = root / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8", newline="\n")
    return root


def minimal_project(extra: dict[str, str] | None = None) -> dict[str, str]:
    """kit.toml with python.sys_path = ["src"] and one decision record."""
    return {
        ".boundaries/kit.toml": f'schema_version = 1\ndecisions = ["{DECISION}"]\n\n[python]\nsys_path = ["src"]\n',
        DECISION: "# 0001 Boundaries\n",
        "src/.keep": "",
        **(extra or {}),
    }


def component(name: str = "web", package: str = "app.web", root: str = "src/app/web", body: str = "") -> str:
    """A Python manifest with the required [component] table plus ``body``."""
    return (
        f'schema_version = 1\n\n[component]\nname = "{name}"\nlanguage = "python"\nroot = "{root}"\n'
        f'package = "{package}"\nprinciple = "Test component."\ndecisions = ["{DECISION}"]\n\n{body}'
    )


def copy_fixture(name: str, dest: Path) -> Path:
    target = dest / name
    shutil.copytree(FIXTURES / name, target, ignore=shutil.ignore_patterns("__pycache__"))
    return target


@dataclass
class CliResult:
    code: int
    stdout: str
    stderr: str


def run_cli(*args: str, cwd: Path | None = None) -> CliResult:
    """Runs ``python -m agent_terminus`` in a child process."""
    r = subprocess.run(
        [sys.executable, "-m", "agent_terminus", *args],
        cwd=cwd or REPO,
        capture_output=True,
        text=True,
        encoding="utf-8",
        check=False,
    )
    return CliResult(r.returncode, r.stdout, r.stderr)
