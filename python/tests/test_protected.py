from __future__ import annotations

from pathlib import Path

from conftest import component, copy_fixture, minimal_project, write_files

from boundaries_kit.checks.protected import check_protected
from boundaries_kit.manifest import load_project


def test_missing_protected_path_and_empty_glob_are_config_errors(tmp_path: Path) -> None:
    body = '[protected]\npaths = ["src/app/web/nope.py", "src/**/*.nope"]\n'
    write_files(tmp_path, minimal_project({".boundaries/web.toml": component(body=body), "src/app/web/a.py": ""}))
    project = load_project(tmp_path)
    assert sorted((p.key, p.message) for p in project.problems) == [
        ("protected.paths[0]", "protected path src/app/web/nope.py does not exist"),
        ("protected.paths[1]", "protected glob src/**/*.nope matches no file"),
    ]


def test_provider_not_covered_is_a_violation(tmp_path: Path) -> None:
    root = copy_fixture("passing", tmp_path)
    toml = root / ".boundaries" / "dashboard.toml"
    toml.write_text(
        toml.read_text(encoding="utf-8").replace(
            'paths = ["src/okapp/dashboard/boundary.py"]', 'paths = ["src/okapp/dashboard/app.py"]'
        ),
        encoding="utf-8",
    )
    project = load_project(root)
    assert project.problems == []
    found = check_protected(project, project.manifests[0])
    assert [(v.key, v.message) for v in found] == [
        (
            "protected.paths",
            "src/okapp/dashboard/boundary.py (from entrypoints[0].provider) is not covered by protected.paths",
        )
    ]


def test_kit_protected_and_globs_cover_providers(tmp_path: Path) -> None:
    root = copy_fixture("passing", tmp_path)
    toml = root / ".boundaries" / "dashboard.toml"
    toml.write_text(
        toml.read_text(encoding="utf-8").replace(
            'paths = ["src/okapp/dashboard/boundary.py"]', 'paths = ["src/okapp/**/bound*.py"]'
        ),
        encoding="utf-8",
    )
    project = load_project(root)
    assert check_protected(project, project.manifests[0]) == []
