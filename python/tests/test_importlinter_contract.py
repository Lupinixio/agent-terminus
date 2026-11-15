"""``lint-imports`` with the custom contract agrees with ``boundaries check``."""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

from conftest import copy_fixture

from boundaries_kit.importlinter_contract import BoundaryContract

RUNNER = (
    "import sys; sys.path.insert(0, 'src'); from importlinter.cli import lint_imports; "
    "sys.exit(lint_imports(no_cache=True, no_logo=True))"
)


def _config(package: str) -> str:
    return (
        f'[tool.importlinter]\nroot_packages = ["{package}"]\n'
        'contract_types = ["boundaries: boundaries_kit.importlinter_contract.BoundaryContract"]\n\n'
        '[[tool.importlinter.contracts]]\nname = "Component boundaries"\ntype = "boundaries"\n'
    )


def _lint(root: Path) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, "-c", RUNNER], cwd=root, capture_output=True, text=True, encoding="utf-8", check=False
    )


def test_passing_fixture_keeps_the_contract(tmp_path: Path) -> None:
    root = copy_fixture("passing", tmp_path)
    (root / "pyproject.toml").write_text(_config("okapp"), encoding="utf-8")
    r = _lint(root)
    assert r.returncode == 0, r.stdout + r.stderr
    assert "1 kept, 0 broken" in r.stdout


def test_violating_fixture_breaks_it_with_the_same_findings(tmp_path: Path) -> None:
    root = copy_fixture("violating", tmp_path)
    (root / "pyproject.toml").write_text(_config("badapp"), encoding="utf-8")
    r = _lint(root)
    assert r.returncode == 1, r.stdout + r.stderr
    for text in ("import sqlite3 is not allowed", "import yaml is not allowed", "badapp.core.engine"):
        assert text in r.stdout


def test_contract_reports_config_errors(tmp_path: Path) -> None:
    contract = BoundaryContract("c", {}, {"manifests": str(tmp_path / ".boundaries")})
    check = contract.check(graph=None, verbose=False)
    assert not check.kept
    assert "no .boundaries/ directory" in check.metadata["errors"][0]
