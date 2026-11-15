"""What the Python adapter checks. Pure."""

from __future__ import annotations

from typing import Any

SCHEMA_VERSIONS: tuple[int, ...] = (1,)

#: Built-in protected paths (copy of schema/builtin-protected.json; cross-tested).
BUILTIN_PROTECTED: tuple[str, ...] = (
    ".boundaries/**",
    ".claude/hooks/protect-boundaries.mjs",
    ".claude/settings.json",
    ".claude/settings.local.json",
    ".githooks/pre-commit",
    ".github/workflows/boundaries.yml",
    ".github/CODEOWNERS",
    "CODEOWNERS",
    "docs/CODEOWNERS",
)

#: Every manifest key path this adapter verifies (arrays of tables: ``key[].sub``).
SUPPORTED_KEYS: frozenset[str] = frozenset(
    {
        "schema_version",
        "component.name",
        "component.language",
        "component.root",
        "component.package",
        "component.exclude",
        "component.principle",
        "component.decisions",
        "imports.internal",
        "imports.internal[].target",
        "imports.internal[].only_from",
        "imports.external",
        "imports.external[].target",
        "imports.external[].only_from",
        "imports.builtin",
        "imports.builtin[].target",
        "imports.builtin[].only_from",
        "calls.forbidden",
        "calls.forbidden[].pattern",
        "calls.forbidden[].reason",
        "entrypoints[].name",
        "entrypoints[].provider",
        "entrypoints[].exact",
        "runtime.bind.hosts",
        "runtime.bind.provider",
        "runtime.secrets.names",
        "runtime.secrets.probe",
        "protected.paths",
    }
)


def key_paths(raw: dict[str, Any]) -> list[str]:
    """Leaf key paths present in a raw manifest."""
    out: set[str] = set()

    def walk(value: Any, path: str) -> None:
        if isinstance(value, dict):
            if not value and path:
                out.add(path)
            for key, child in value.items():
                walk(child, f"{path}.{key}" if path else key)
        elif isinstance(value, list):
            if not value or any(not isinstance(item, dict) for item in value):
                out.add(path)
            for item in value:
                if isinstance(item, dict):
                    walk(item, f"{path}[]")
        else:
            out.add(path)

    walk(raw, "")
    return sorted(out)


def unsupported_keys(raw: dict[str, Any]) -> list[str]:
    """Key paths in a raw manifest that this adapter does not check."""
    return [key for key in key_paths(raw) if key not in SUPPORTED_KEYS]
