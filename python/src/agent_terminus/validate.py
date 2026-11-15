"""Hand-written validators mirroring schema/manifest.schema.json and schema/kit.schema.json.

Pure. Held to the schemas by the conformance corpus in schema/fixtures (see
tests/test_validate_conformance.py). Problem keys match the Node adapter.
"""

from __future__ import annotations

import json
import re
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class Problem:
    """A config error (exit 3)."""

    file: str
    key: str
    message: str


def _re(pattern: str) -> re.Pattern[str]:
    return re.compile(pattern, re.ASCII)


PATTERNS: dict[str, re.Pattern[str]] = {
    "name": _re(r"^(?!kit$)[a-z][a-z0-9-]{0,62}$"),
    "relPath": _re(r"^(?![/\\])(?![A-Za-z]:)(?!(?:.*[/\\])?\.\.(?:[/\\]|$))[^*?\[\]{}]+$"),
    "relGlob": _re(r"^(?![/\\])(?![A-Za-z]:)(?!(?:.*[/\\])?\.\.(?:[/\\]|$))[^\[\]{}]+$"),
    "dotted": _re(r"^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$"),
    "ref": _re(r"^([A-Za-z_]\w*(\.[A-Za-z_]\w*)*:[A-Za-z_]\w*|\./[^#]+#[A-Za-z_$][\w$]*)$"),
    "callPattern": _re(r"^(\*\.)?[A-Za-z_$*][\w$*]*(\.[A-Za-z_$*][\w$*]*)*$"),
    "entrypointName": _re(r"^[a-z][a-z0-9-]*$"),
    "secretName": _re(r"^[A-Za-z_][A-Za-z0-9_]*$"),
}


def _join(path: str, key: str) -> str:
    return f"{path}.{key}" if path else key


def _is_one(value: Any) -> bool:
    return type(value) is int and value == 1


class _Collector:
    def __init__(self, file: str) -> None:
        self.file = file
        self.problems: list[Problem] = []

    def add(self, key: str, message: str) -> None:
        self.problems.append(Problem(self.file, key, message))

    def shape(self, table: dict[str, Any], path: str, allowed: list[str], required: list[str]) -> None:
        for key in table:
            if key not in allowed:
                self.add(_join(path, key), f'unknown key "{key}"')
        for key in required:
            if key not in table:
                self.add(_join(path, key), "is required")

    def patterned(self, value: Any, key: str, pattern: str, what: str) -> None:
        if not isinstance(value, str):
            self.add(key, f"must be a string ({what})")
        elif not PATTERNS[pattern].fullmatch(value):
            self.add(key, f"{json.dumps(value)} is not a valid {what}")

    def string(self, value: Any, key: str, min_length: int = 1) -> None:
        if not isinstance(value, str):
            self.add(key, "must be a string")
        elif len(value) < min_length:
            self.add(key, "must not be empty")

    def array(
        self,
        value: Any,
        key: str,
        each: Callable[[Any, str], None],
        *,
        min_items: int | None = None,
        unique: bool = False,
    ) -> None:
        if not isinstance(value, list):
            self.add(key, "must be an array")
            return
        if min_items is not None and len(value) < min_items:
            self.add(key, f"must have at least {min_items} item(s)")
        if unique:
            seen: set[str] = set()
            for item in value:
                ident = json.dumps(item, sort_keys=True, default=str)
                if ident in seen:
                    self.add(key, f"duplicate item {ident}")
                seen.add(ident)
        for index, item in enumerate(value):
            each(item, f"{key}[{index}]")

    def table(self, value: Any, key: str) -> bool:
        if not isinstance(value, dict):
            self.add(key, "must be a table")
            return False
        return True


def _allow_list(c: _Collector, value: Any, key: str) -> None:
    if value == "any":
        return
    if not isinstance(value, list):
        c.add(key, 'must be "any" or an array of targets')
        return

    def each(item: Any, item_key: str) -> None:
        if isinstance(item, str):
            c.string(item, item_key)
            return
        if not isinstance(item, dict):
            c.add(item_key, "must be a string or a { target, only_from } table")
            return
        c.shape(item, item_key, ["target", "only_from"], ["target", "only_from"])
        if "target" in item:
            c.string(item["target"], f"{item_key}.target")
        if "only_from" in item:
            c.array(item["only_from"], f"{item_key}.only_from", c.string, min_items=1)

    c.array(value, key, each)


def validate_manifest(raw: Any, file: str) -> list[Problem]:
    """Validates a parsed manifest against the manifest schema (schema rules only)."""
    c = _Collector(file)
    if not c.table(raw, ""):
        return c.problems
    doc: dict[str, Any] = raw
    c.shape(
        doc,
        "",
        ["schema_version", "component", "imports", "calls", "entrypoints", "runtime", "protected"],
        ["schema_version", "component"],
    )
    if "schema_version" in doc and not _is_one(doc["schema_version"]):
        c.add("schema_version", f"unsupported schema_version {json.dumps(doc['schema_version'])} (supported: 1)")

    if "component" in doc and c.table(doc["component"], "component"):
        comp: dict[str, Any] = doc["component"]
        c.shape(
            comp,
            "component",
            ["name", "language", "root", "package", "exclude", "principle", "decisions"],
            ["name", "language", "root", "principle", "decisions"],
        )
        if "name" in comp:
            c.patterned(comp["name"], "component.name", "name", "component name")
        if "language" in comp and comp["language"] not in ("python", "node"):
            c.add("component.language", 'must be "python" or "node"')
        if "root" in comp:
            c.patterned(comp["root"], "component.root", "relPath", "relative path")
        if "package" in comp:
            c.patterned(comp["package"], "component.package", "dotted", "dotted name")
        if comp.get("language") == "python" and "package" not in comp:
            c.add("component.package", 'is required when language = "python"')
        if "exclude" in comp:
            c.array(comp["exclude"], "component.exclude", lambda g, k: c.patterned(g, k, "relGlob", "relative glob"))
        if "principle" in comp:
            c.string(comp["principle"], "component.principle")
            if isinstance(comp["principle"], str) and len(comp["principle"]) > 300:
                c.add("component.principle", "must be at most 300 characters")
        if "decisions" in comp:
            c.array(
                comp["decisions"],
                "component.decisions",
                lambda p, k: c.patterned(p, k, "relPath", "relative path"),
                min_items=1,
            )

    if "imports" in doc and c.table(doc["imports"], "imports"):
        imports: dict[str, Any] = doc["imports"]
        kinds = ["internal", "external", "builtin"]
        c.shape(imports, "imports", kinds, kinds)
        for kind in kinds:
            if kind in imports:
                _allow_list(c, imports[kind], f"imports.{kind}")

    if "calls" in doc and c.table(doc["calls"], "calls"):
        calls: dict[str, Any] = doc["calls"]
        c.shape(calls, "calls", ["forbidden"], ["forbidden"])

        def call_item(item: Any, key: str) -> None:
            if isinstance(item, str):
                c.patterned(item, key, "callPattern", "call pattern")
            elif isinstance(item, dict):
                c.shape(item, key, ["pattern", "reason"], ["pattern"])
                if "pattern" in item:
                    c.patterned(item["pattern"], f"{key}.pattern", "callPattern", "call pattern")
                if "reason" in item:
                    c.string(item["reason"], f"{key}.reason")
            else:
                c.add(key, "must be a call pattern or a { pattern, reason } table")

        if "forbidden" in calls:
            c.array(calls["forbidden"], "calls.forbidden", call_item, min_items=1)

    if "entrypoints" in doc:

        def group_item(item: Any, key: str) -> None:
            if not c.table(item, key):
                return
            c.shape(item, key, ["name", "provider", "exact"], ["name", "provider", "exact"])
            if "name" in item:
                c.patterned(item["name"], f"{key}.name", "entrypointName", "entrypoint group name")
            if "provider" in item:
                c.patterned(item["provider"], f"{key}.provider", "ref", "provider reference")
            if "exact" in item:
                c.array(item["exact"], f"{key}.exact", c.string, unique=True)

        c.array(doc["entrypoints"], "entrypoints", group_item, min_items=1)

    if "runtime" in doc and c.table(doc["runtime"], "runtime"):
        runtime: dict[str, Any] = doc["runtime"]
        c.shape(runtime, "runtime", ["bind", "secrets"], [])
        if not runtime:
            c.add("runtime", "must contain bind or secrets")
        if "bind" in runtime and c.table(runtime["bind"], "runtime.bind"):
            bind: dict[str, Any] = runtime["bind"]
            c.shape(bind, "runtime.bind", ["hosts", "provider"], ["hosts", "provider"])
            if "hosts" in bind:
                c.array(bind["hosts"], "runtime.bind.hosts", c.string, min_items=1)
            if "provider" in bind:
                c.patterned(bind["provider"], "runtime.bind.provider", "ref", "provider reference")
        if "secrets" in runtime and c.table(runtime["secrets"], "runtime.secrets"):
            secrets: dict[str, Any] = runtime["secrets"]
            c.shape(secrets, "runtime.secrets", ["names", "probe"], ["names", "probe"])
            if "names" in secrets:
                c.array(
                    secrets["names"],
                    "runtime.secrets.names",
                    lambda n, k: c.patterned(n, k, "secretName", "secret name"),
                    min_items=1,
                    unique=True,
                )
            if "probe" in secrets:
                c.patterned(secrets["probe"], "runtime.secrets.probe", "ref", "probe reference")

    if "protected" in doc and c.table(doc["protected"], "protected"):
        prot: dict[str, Any] = doc["protected"]
        c.shape(prot, "protected", ["paths"], ["paths"])
        if "paths" in prot:
            c.array(
                prot["paths"],
                "protected.paths",
                lambda g, k: c.patterned(g, k, "relGlob", "relative glob"),
                min_items=1,
            )
    return c.problems


def validate_kit(raw: Any, file: str) -> list[Problem]:
    """Validates a parsed ``.boundaries/kit.toml`` against the kit schema."""
    c = _Collector(file)
    if not c.table(raw, ""):
        return c.problems
    doc: dict[str, Any] = raw
    c.shape(
        doc,
        "",
        ["schema_version", "decisions", "rules_lint", "protected", "hook", "python", "node"],
        ["schema_version"],
    )
    if "schema_version" in doc and not _is_one(doc["schema_version"]):
        c.add("schema_version", f"unsupported schema_version {json.dumps(doc['schema_version'])} (supported: 1)")
    if "decisions" in doc:
        c.array(doc["decisions"], "decisions", lambda p, k: c.patterned(p, k, "relPath", "relative path"))
    if "rules_lint" in doc and c.table(doc["rules_lint"], "rules_lint"):
        lint: dict[str, Any] = doc["rules_lint"]
        c.shape(lint, "rules_lint", ["files", "allow"], [])
        if "files" in lint:
            c.array(lint["files"], "rules_lint.files", lambda g, k: c.patterned(g, k, "relGlob", "relative glob"))
        if "allow" in lint:
            c.array(lint["allow"], "rules_lint.allow", c.string)
    if "protected" in doc and c.table(doc["protected"], "protected"):
        prot: dict[str, Any] = doc["protected"]
        c.shape(prot, "protected", ["paths"], [])
        if "paths" in prot:
            c.array(prot["paths"], "protected.paths", lambda g, k: c.patterned(g, k, "relGlob", "relative glob"))
    if "hook" in doc and c.table(doc["hook"], "hook"):
        hook: dict[str, Any] = doc["hook"]
        c.shape(hook, "hook", ["decision"], [])
        if "decision" in hook and hook["decision"] not in ("ask", "deny"):
            c.add("hook.decision", 'must be "ask" or "deny"')
    if "python" in doc and c.table(doc["python"], "python"):
        py: dict[str, Any] = doc["python"]
        c.shape(py, "python", ["sys_path"], [])
        if "sys_path" in py:
            c.array(py["sys_path"], "python.sys_path", lambda p, k: c.patterned(p, k, "relPath", "relative path"))
    if "node" in doc and c.table(doc["node"], "node"):
        node: dict[str, Any] = doc["node"]
        c.shape(node, "node", ["tsconfig"], [])
        if "tsconfig" in node:
            c.patterned(node["tsconfig"], "node.tsconfig", "relPath", "relative path")
    return c.problems
