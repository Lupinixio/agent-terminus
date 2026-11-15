from __future__ import annotations

import io
import json
from pathlib import Path

from conftest import component, copy_fixture, minimal_project, run_cli, write_files

from boundaries_kit import __version__
from boundaries_kit.cli import main
from boundaries_kit.testing import assert_boundaries_hold


def _run(*args: str, cwd: Path) -> tuple[int, str, str]:
    out, err = io.StringIO(), io.StringIO()
    code = main(list(args), cwd=cwd, out=out, err=err)
    return code, out.getvalue(), err.getvalue()


def test_usage_errors_exit_2(tmp_path: Path) -> None:
    write_files(tmp_path, minimal_project())
    assert _run(cwd=tmp_path)[0] == 2
    assert _run("frobnicate", cwd=tmp_path)[0] == 2
    assert _run("check", "--bogus", cwd=tmp_path)[0] == 2
    assert _run("check", "--format", "xml", cwd=tmp_path)[0] == 2
    assert _run("check", "--component", "nope", cwd=tmp_path)[0] == 2
    assert _run("--help", cwd=tmp_path)[0] == 0
    assert _run("--version", cwd=tmp_path)[1].strip() == __version__


def test_node_only_commands_point_to_the_node_cli(tmp_path: Path) -> None:
    code, _, err = _run("lint-rules", cwd=tmp_path)
    assert code == 2
    assert "npx boundaries lint-rules" in err


def test_no_boundaries_directory_is_a_config_error(tmp_path: Path) -> None:
    code, out, _ = _run("check", cwd=tmp_path)
    assert code == 3
    assert "no .boundaries/ directory" in out


def test_keys_json() -> None:
    r = run_cli("keys", "--json")
    payload = json.loads(r.stdout)
    assert payload["adapter"] == "python"
    assert payload["schema_versions"] == [1]
    assert "component.package" in payload["supported_keys"]


def test_json_report_shape(tmp_path: Path) -> None:
    write_files(tmp_path, minimal_project())
    code, out, _ = _run("check", "--format", "json", cwd=tmp_path)
    assert code == 4
    assert sorted(json.loads(out)) == ["adapter", "errors", "results", "schema_version", "skipped", "stale"]


def test_adapter_rules(tmp_path: Path) -> None:
    body = (
        '[[entrypoints]]\nname = "routes"\nprovider = "./ui/boundary.js#routes"\nexact = []\n\n'
        '[imports]\ninternal = ["src/app"]\nexternal = []\nbuiltin = []\n\n'
        '[protected]\npaths = ["src/nope.py"]\n'
    )
    manifest = component(name="web", root="src/missing", body=body).replace("0001-boundaries", "0002-missing")
    write_files(tmp_path, minimal_project({".boundaries/ui.toml": manifest}))
    code, out, _ = _run("validate", "--format", "json", cwd=tmp_path)
    assert code == 3
    keys = sorted(e["key"] for e in json.loads(out)["errors"])
    assert keys == [
        "component.decisions[0]",
        "component.name",
        "component.root",
        "entrypoints[0].provider",
        "imports.internal[0]",
        "protected.paths[0]",
    ]


def test_fixtures_passing_0_violating_1_with_every_check(tmp_path: Path) -> None:
    passing = run_cli("check", "--root", "fixtures/python/passing")
    assert passing.code == 0, passing.stdout + passing.stderr
    assert "boundaries (python): ok, 1 component(s) checked" in passing.stdout
    violating = run_cli("check", "--root", "fixtures/python/violating", "--format", "json")
    assert violating.code == 1, violating.stdout + violating.stderr
    report = json.loads(violating.stdout)
    assert sorted({r["check"] for r in report["results"]}) == [
        "calls",
        "entrypoints",
        "imports",
        "runtime.bind",
        "runtime.secrets",
    ]


def test_invalid_manifest_exits_3_before_any_check(tmp_path: Path) -> None:
    root = copy_fixture("violating", tmp_path)
    toml = root / ".boundaries" / "dashboard.toml"
    toml.write_text(toml.read_text(encoding="utf-8").replace('name = "http"', 'name = "HTTP"'), encoding="utf-8")
    r = run_cli("check", "--root", str(root), "--format", "json")
    assert r.code == 3, r.stdout + r.stderr
    report = json.loads(r.stdout)
    assert report["results"] == []
    assert [e["key"] for e in report["errors"]] == ["entrypoints[0].name"]


def test_tmp_copy_mutations(tmp_path: Path) -> None:
    root = copy_fixture("passing", tmp_path)
    app = root / "src" / "okapp" / "dashboard" / "app.py"
    app.write_text(app.read_text(encoding="utf-8") + "\nimport subprocess\n", encoding="utf-8")
    r = run_cli("check", "--root", str(root))
    assert r.code == 1
    assert "import subprocess is not allowed by imports.builtin" in r.stdout


def test_component_filter(tmp_path: Path) -> None:
    root = copy_fixture("violating", tmp_path)
    r = run_cli("check", "--root", str(root), "--component", "dashboard")
    assert r.code == 1


def test_assert_boundaries_hold(tmp_path: Path) -> None:
    root = copy_fixture("passing", tmp_path)
    assert_boundaries_hold(root)
    bad = copy_fixture("violating", tmp_path)
    try:
        assert_boundaries_hold(bad)
    except AssertionError as error:
        assert "9 violation(s)" in str(error)
    else:
        raise AssertionError("expected a failure")
