from __future__ import annotations

from pathlib import Path

from conftest import component, minimal_project, run_cli, write_files

from boundaries_kit.support import SUPPORTED_KEYS, key_paths, unsupported_keys


def test_key_paths_write_arrays_of_tables_as_key_sub() -> None:
    raw = {
        "imports": {"internal": ["a", {"target": "b", "only_from": ["c"]}], "external": "any", "builtin": []},
        "entrypoints": [{"name": "http", "provider": "p", "exact": []}],
    }
    assert key_paths(raw) == [
        "entrypoints[].exact",
        "entrypoints[].name",
        "entrypoints[].provider",
        "imports.builtin",
        "imports.external",
        "imports.internal",
        "imports.internal[].only_from",
        "imports.internal[].target",
    ]


def test_component_package_is_supported() -> None:
    assert "component.package" in SUPPORTED_KEYS
    assert unsupported_keys({"component": {"package": "x"}}) == []


def test_unknown_key_runtime_network_gives_exit_3(tmp_path: Path) -> None:
    write_files(
        tmp_path,
        minimal_project(
            {
                ".boundaries/web.toml": component(body="[runtime.network]\nallow = []\n"),
                "src/app/web/__init__.py": "",
            }
        ),
    )
    r = run_cli("validate", "--root", str(tmp_path))
    assert r.code == 3, r.stdout + r.stderr
    assert "runtime.network" in r.stdout


def test_schema_version_2_gives_exit_3(tmp_path: Path) -> None:
    manifest = component().replace("schema_version = 1", "schema_version = 2")
    write_files(tmp_path, minimal_project({".boundaries/web.toml": manifest, "src/app/web/__init__.py": ""}))
    r = run_cli("check", "--root", str(tmp_path))
    assert r.code == 3, r.stdout + r.stderr
    assert "schema_version" in r.stdout


def test_node_manifests_are_skipped(tmp_path: Path) -> None:
    node = (
        'schema_version = 1\n\n[component]\nname = "ui"\nlanguage = "node"\nroot = "src/ui"\n'
        'principle = "UI."\ndecisions = ["docs/decisions/0001-boundaries.md"]\n'
    )
    write_files(tmp_path, minimal_project({".boundaries/ui.toml": node, "src/ui/a.js": ""}))
    assert run_cli("generate", "--root", str(tmp_path)).code == 0
    r = run_cli("check", "--root", str(tmp_path))
    assert r.code == 0, r.stdout + r.stderr
    assert "skipped: ui (language node is checked by its own adapter)" in r.stdout
