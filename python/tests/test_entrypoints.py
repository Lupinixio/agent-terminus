from __future__ import annotations

from pathlib import Path

import pytest
from conftest import FIXTURES, component, copy_fixture, minimal_project, write_files

from boundaries_kit.checks import ConfigError
from boundaries_kit.checks.entrypoints import check_entrypoints, compare_entrypoints
from boundaries_kit.manifest import load_project
from boundaries_kit.testing import assert_entrypoints


def test_compare_normalizes_whitespace() -> None:
    assert compare_entrypoints(["GET  /", "POST /a"], [" GET /", "POST /b"]) == (["POST /a"], ["POST /b"])


def test_extra_route_in_violating_fixture() -> None:
    project = load_project(FIXTURES / "violating")
    found = check_entrypoints(project, project.manifests[0])
    assert [(v.key, v.message) for v in found] == [
        ("entrypoints[0].exact", 'http: "POST /api/flatten" is exposed but not declared')
    ]
    passing = load_project(FIXTURES / "passing")
    assert check_entrypoints(passing, passing.manifests[0]) == []


def test_missing_route(tmp_path: Path) -> None:
    root = copy_fixture("passing", tmp_path)
    toml = root / ".boundaries" / "dashboard.toml"
    toml.write_text(
        toml.read_text(encoding="utf-8").replace('"POST /api/pause"]', '"POST /api/pause", "POST /api/resume"]'),
        encoding="utf-8",
    )
    project = load_project(root)
    found = check_entrypoints(project, project.manifests[0])
    assert [v.message for v in found] == ['http: "POST /api/resume" is declared but not exposed']


def test_provider_errors_are_config_errors(tmp_path: Path) -> None:
    body = (
        '[[entrypoints]]\nname = "http"\nprovider = "app.web.boundary:{fn}"\nexact = []\n\n'
        '[protected]\npaths = ["src/app/web/boundary.py"]\n'
    )
    code = "def routes():\n    return 'GET /'\n\ndef boom():\n    raise RuntimeError('no app')\n"
    for fn, message in (("missing", "no callable"), ("routes", "iterable of strings"), ("boom", "no app")):
        root = tmp_path / fn
        write_files(
            root,
            minimal_project(
                {
                    ".boundaries/web.toml": component(body=body.format(fn=fn)),
                    "src/app/__init__.py": "",
                    "src/app/web/__init__.py": "",
                    "src/app/web/boundary.py": code,
                }
            ),
        )
        project = load_project(root)
        assert project.problems == []
        with pytest.raises(ConfigError, match=message):
            check_entrypoints(project, project.manifests[0])


def test_assert_entrypoints_lists_every_difference() -> None:
    manifest = load_project(FIXTURES / "passing").manifests[0]
    assert_entrypoints(manifest, ["GET /", "GET /api/status", "POST /api/pause"])
    with pytest.raises(AssertionError) as info:
        assert_entrypoints(manifest, ["GET /", "DELETE /x"])
    text = str(info.value)
    assert "exposed but not declared: DELETE /x" in text
    assert "declared but not exposed: POST /api/pause" in text
    with pytest.raises(AssertionError, match="no entrypoint group"):
        assert_entrypoints(manifest, [], group="cli")
