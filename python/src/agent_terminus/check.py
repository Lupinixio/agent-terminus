"""``boundaries check``: validate, run every check for Python components and verify
the generated files. Checks return violations; only the CLI picks exit codes."""

from __future__ import annotations

from collections.abc import Callable, Iterable
from dataclasses import dataclass
from pathlib import Path

from .checks import ConfigError
from .checks.calls import check_calls
from .checks.entrypoints import check_entrypoints
from .checks.imports import check_imports
from .checks.protected import check_protected
from .checks.runtime import check_bind, check_secrets
from .generate import generate
from .manifest import ADAPTER, Manifest, Project, load_project
from .report import Report, Skipped, Violation
from .validate import Problem

CHECKS: tuple[Callable[[Project, Manifest], list[Violation]], ...] = (
    check_imports,
    check_calls,
    check_entrypoints,
    check_bind,
    check_secrets,
    check_protected,
)


@dataclass
class CheckResult:
    report: Report
    checked: int
    project: Project


def skipped_components(project: Project) -> list[Skipped]:
    return [
        Skipped(m.component.name, f"language {m.component.language} is checked by its own adapter")
        for m in project.manifests
        if m.component.language != ADAPTER
    ]


def validate_project(root: Path | str = ".") -> tuple[Report, Project]:
    """``boundaries validate``: schema, support set and file existence; runs no project code."""
    project = load_project(root)
    report = Report(errors=list(project.problems), skipped=skipped_components(project))
    return report, project


def check(root: Path | str = ".", components: Iterable[str] | None = None) -> CheckResult:
    report, project = validate_project(root)
    own = [m for m in project.manifests if m.component.language == ADAPTER]
    if report.errors:
        return CheckResult(report, 0, project)
    wanted = list(components or ())
    selected = [m for m in own if m.component.name in wanted] if wanted else own
    for manifest in selected:
        for run in CHECKS:
            try:
                report.results += run(project, manifest)
            except ConfigError as error:
                report.errors.append(Problem(error.file, error.key, error.message))
    if report.errors:
        return CheckResult(report, len(selected), project)
    report.stale += [s.file for s in generate(project, write=False) if s.stale]
    return CheckResult(report, len(selected), project)
