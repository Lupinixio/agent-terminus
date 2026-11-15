"""Report shape, renderers and exit codes. Pure."""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass, field

from .validate import Problem

EXIT_OK = 0
EXIT_VIOLATIONS = 1
EXIT_USAGE = 2
EXIT_CONFIG = 3
EXIT_STALE = 4
EXIT_INTERNAL = 70


@dataclass(frozen=True)
class Violation:
    component: str
    check: str
    key: str
    location: str | None
    message: str


@dataclass(frozen=True)
class Skipped:
    component: str
    reason: str


@dataclass
class Report:
    adapter: str = "python"
    results: list[Violation] = field(default_factory=list)
    skipped: list[Skipped] = field(default_factory=list)
    stale: list[str] = field(default_factory=list)
    errors: list[Problem] = field(default_factory=list)


def exit_code(report: Report) -> int:
    """Config errors, then violations, then stale files."""
    if report.errors:
        return EXIT_CONFIG
    if report.results:
        return EXIT_VIOLATIONS
    if report.stale:
        return EXIT_STALE
    return EXIT_OK


def render_json(report: Report) -> str:
    payload = {
        "schema_version": 1,
        "adapter": report.adapter,
        "results": [asdict(v) for v in report.results],
        "skipped": [asdict(s) for s in report.skipped],
        "stale": list(report.stale),
        "errors": [asdict(e) for e in report.errors],
    }
    return json.dumps(payload, indent=2, ensure_ascii=False) + "\n"


def render_text(report: Report, checked: int | None = None) -> str:
    lines = [f"{e.file}: {e.message}" + (f" [{e.key}]" if e.key else "") for e in report.errors]
    for r in report.results:
        location = f" {r.location}" if r.location else ""
        lines.append(f"{r.component} {r.check}{location}: {r.message} [{r.key}]")
    lines += [f"stale: {s} (run boundaries generate)" for s in report.stale]
    lines += [f"skipped: {s.component} ({s.reason})" for s in report.skipped]
    checked_text = "" if checked is None else f", {checked} component(s) checked"
    if exit_code(report) == EXIT_OK:
        lines.append(f"boundaries ({report.adapter}): ok{checked_text}, {len(report.skipped)} skipped")
    else:
        lines.append(
            f"boundaries ({report.adapter}): {len(report.errors)} config error(s), "
            f"{len(report.results)} violation(s), {len(report.stale)} stale file(s){checked_text}, "
            f"{len(report.skipped)} skipped"
        )
    return "\n".join(lines) + "\n"
