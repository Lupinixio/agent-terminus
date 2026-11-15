"""Loads ``.boundaries/`` (kit.toml and every component manifest) and applies the
adapter rules beyond the schema. Reads files; runs no project code."""

from __future__ import annotations

import re
import tomllib
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Literal

from . import glob as globmod
from .checks.decisions import decision_problems
from .files import glob_files
from .kit_config import KitConfig, kit_from_raw
from .support import unsupported_keys
from .validate import Problem, validate_kit, validate_manifest

ADAPTER = "python"
BOUNDARIES_DIR = ".boundaries"

_PY_REF = re.compile(r"^[A-Za-z_]\w*(\.[A-Za-z_]\w*)*:[A-Za-z_]\w*$", re.ASCII)
_DOTTED = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$", re.ASCII)

AllowKind = Literal["internal", "external", "builtin"]
KINDS: tuple[AllowKind, ...] = ("internal", "external", "builtin")


@dataclass(frozen=True)
class AllowEntry:
    target: str
    only_from: tuple[str, ...] | None = None


AllowList = Literal["any"] | tuple[AllowEntry, ...]


@dataclass(frozen=True)
class Imports:
    internal: AllowList
    external: AllowList
    builtin: AllowList

    def of(self, kind: AllowKind) -> AllowList:
        value: AllowList = getattr(self, kind)
        return value


@dataclass(frozen=True)
class CallPattern:
    pattern: str
    reason: str | None = None


@dataclass(frozen=True)
class EntrypointGroup:
    name: str
    provider: str
    exact: tuple[str, ...]


@dataclass(frozen=True)
class Bind:
    hosts: tuple[str, ...]
    provider: str


@dataclass(frozen=True)
class Secrets:
    names: tuple[str, ...]
    probe: str


@dataclass(frozen=True)
class Component:
    name: str
    language: str
    root: str
    package: str | None
    exclude: tuple[str, ...]
    principle: str
    decisions: tuple[str, ...]


@dataclass(frozen=True)
class Manifest:
    file: str
    raw: dict[str, Any] = field(repr=False, compare=False)
    component: Component
    imports: Imports | None = None
    calls: tuple[CallPattern, ...] | None = None
    entrypoints: tuple[EntrypointGroup, ...] = ()
    bind: Bind | None = None
    secrets: Secrets | None = None
    protected: tuple[str, ...] = ()


@dataclass
class Project:
    root: Path
    kit: KitConfig
    manifests: list[Manifest]
    problems: list[Problem]


def _allow(value: Any) -> AllowList:
    if value == "any":
        return "any"
    out = []
    for item in value:
        if isinstance(item, str):
            out.append(AllowEntry(item))
        else:
            out.append(AllowEntry(item["target"], tuple(item["only_from"])))
    return tuple(out)


def manifest_from_raw(raw: dict[str, Any], file: str) -> Manifest:
    """Builds a Manifest from a raw table that passed schema validation."""
    comp = raw["component"]
    imports = raw.get("imports")
    calls = raw.get("calls")
    runtime = raw.get("runtime", {})
    bind = runtime.get("bind")
    secrets = runtime.get("secrets")
    return Manifest(
        file=file,
        raw=raw,
        component=Component(
            name=comp["name"],
            language=comp["language"],
            root=comp["root"].rstrip("/"),
            package=comp.get("package"),
            exclude=tuple(comp.get("exclude", ())),
            principle=comp["principle"],
            decisions=tuple(comp["decisions"]),
        ),
        imports=Imports(_allow(imports["internal"]), _allow(imports["external"]), _allow(imports["builtin"]))
        if imports
        else None,
        calls=tuple(
            CallPattern(item) if isinstance(item, str) else CallPattern(item["pattern"], item.get("reason"))
            for item in calls["forbidden"]
        )
        if calls
        else None,
        entrypoints=tuple(
            EntrypointGroup(g["name"], g["provider"], tuple(g["exact"])) for g in raw.get("entrypoints", ())
        ),
        bind=Bind(tuple(bind["hosts"]), bind["provider"]) if bind else None,
        secrets=Secrets(tuple(secrets["names"]), secrets["probe"]) if secrets else None,
        protected=tuple(raw.get("protected", {}).get("paths", ())),
    )


def protected_path_problems(root: Path, path: str, file: str, key: str) -> list[Problem]:
    """A non-glob protected path must exist; a glob must match at least one file."""
    if globmod.has_glob_chars(path):
        if not glob_files(root, path):
            return [Problem(file, key, f"protected glob {path} matches no file")]
        return []
    return [] if (root / path).exists() else [Problem(file, key, f"protected path {path} does not exist")]


def _common_rules(root: Path, m: Manifest) -> list[Problem]:
    problems: list[Problem] = []
    stem = Path(m.file).stem
    if m.component.name != stem:
        problems.append(
            Problem(m.file, "component.name", f'name "{m.component.name}" must equal the file name "{stem}"')
        )
    problems += decision_problems(root, m.component.decisions, m.file, "component.decisions")
    if not (root / m.component.root).is_dir():
        problems.append(Problem(m.file, "component.root", f"component root {m.component.root} is not a directory"))
    for i, p in enumerate(m.protected):
        problems += protected_path_problems(root, p, m.file, f"protected.paths[{i}]")
    return problems


def python_rules(m: Manifest) -> list[Problem]:
    """Python-specific adapter rules: support set, reference and target syntax."""
    problems = [
        Problem(m.file, key, f"key {key} is not checked by the {ADAPTER} adapter") for key in unsupported_keys(m.raw)
    ]

    def ref(key: str, value: str) -> None:
        if not _PY_REF.fullmatch(value):
            problems.append(Problem(m.file, key, f'"{value}" is not a Python reference (module:attribute)'))

    for i, g in enumerate(m.entrypoints):
        ref(f"entrypoints[{i}].provider", g.provider)
    if m.bind:
        ref("runtime.bind.provider", m.bind.provider)
    if m.secrets:
        ref("runtime.secrets.probe", m.secrets.probe)
    if m.imports:
        for kind in KINDS:
            entries = m.imports.of(kind)
            if entries == "any":
                continue
            for i, entry in enumerate(entries):
                key = f"imports.{kind}[{i}]"
                if not _DOTTED.fullmatch(entry.target):
                    problems.append(Problem(m.file, key, f'"{entry.target}" is not a valid Python {kind} target'))
                for j, origin in enumerate(entry.only_from or ()):
                    if not _DOTTED.fullmatch(origin):
                        problems.append(
                            Problem(m.file, f"{key}.only_from[{j}]", f'"{origin}" is not a dotted module name')
                        )
    return problems


def _read_toml(path: Path, rel: str) -> tuple[Any, Problem | None]:
    try:
        return tomllib.loads(path.read_text(encoding="utf-8")), None
    except (tomllib.TOMLDecodeError, UnicodeDecodeError) as error:
        return None, Problem(rel, "", f"TOML parse error: {str(error).splitlines()[0]}")


def load_manifest(path: Path) -> Manifest:
    """Loads one manifest file (schema-validated); raises ValueError on problems."""
    rel = f"{BOUNDARIES_DIR}/{path.name}"
    raw, problem = _read_toml(path, rel)
    if problem:
        raise ValueError(problem.message)
    problems = validate_manifest(raw, rel)
    if problems:
        raise ValueError("; ".join(f"{p.key}: {p.message}" for p in problems))
    return manifest_from_raw(raw, rel)


def load_project(root: Path | str) -> Project:
    """Loads kit.toml and every manifest under ``<root>/.boundaries/``.

    ``problems`` holds every config error (exit 3) for this adapter.
    """
    abs_root = Path(root).resolve()
    problems: list[Problem] = []
    kit = KitConfig()
    manifests: list[Manifest] = []
    directory = abs_root / BOUNDARIES_DIR
    if not directory.is_dir():
        problems.append(
            Problem(BOUNDARIES_DIR, "", f"no {BOUNDARIES_DIR}/ directory under {abs_root} (run boundaries init)")
        )
        return Project(abs_root, kit, manifests, problems)
    for path in sorted(p for p in directory.iterdir() if p.is_file() and p.name.endswith(".toml")):
        rel = f"{BOUNDARIES_DIR}/{path.name}"
        raw, problem = _read_toml(path, rel)
        if problem:
            problems.append(problem)
            continue
        if path.name == "kit.toml":
            kit_problems = validate_kit(raw, rel)
            problems += kit_problems
            if not kit_problems:
                kit = kit_from_raw(raw, rel)
                problems += decision_problems(abs_root, kit.decisions, rel, "decisions")
                for i, p in enumerate(kit.protected):
                    problems += protected_path_problems(abs_root, p, rel, f"protected.paths[{i}]")
                for i, p in enumerate(kit.python_sys_path):
                    if not (abs_root / p).is_dir():
                        problems.append(Problem(rel, f"python.sys_path[{i}]", f"{p} is not a directory"))
            continue
        schema_problems = validate_manifest(raw, rel)
        if schema_problems:
            problems += schema_problems
            continue
        manifest = manifest_from_raw(raw, rel)
        problems += _common_rules(abs_root, manifest)
        if manifest.component.language == ADAPTER:
            problems += python_rules(manifest)
        manifests.append(manifest)
    return Project(abs_root, kit, manifests, problems)
