"""Command-line interface. The only place that picks exit codes."""

from __future__ import annotations

import argparse
import json
import sys
import traceback
from collections.abc import Sequence
from pathlib import Path
from typing import NoReturn, TextIO

from . import __version__
from .check import check, validate_project
from .generate import generate
from .manifest import ADAPTER
from .report import EXIT_CONFIG, EXIT_INTERNAL, EXIT_OK, EXIT_USAGE, Report, exit_code, render_json, render_text
from .support import SCHEMA_VERSIONS, SUPPORTED_KEYS

NODE_ONLY = ("lint-rules", "diff", "codeowners", "init")

USAGE = f"""boundaries {__version__} (python adapter)

Usage:
  boundaries check     [--root .] [--component NAME]... [--format text|json]
  boundaries validate  [--root .] [--format text|json]
  boundaries generate  [--root .]
  boundaries keys      --json

lint-rules, diff, codeowners and init are provided by the Node CLI
(npx boundaries <command>).

Exit codes: 0 pass, 1 violations, 2 usage, 3 config, 4 stale generated files, 70 internal error.
"""


class UsageError(Exception):
    pass


class _Parser(argparse.ArgumentParser):
    def error(self, message: str) -> NoReturn:
        raise UsageError(message)


def _parser() -> _Parser:
    parser = _Parser(prog="boundaries", add_help=False)
    sub = parser.add_subparsers(dest="command", parser_class=_Parser)
    for name in ("check", "validate"):
        p = sub.add_parser(name, add_help=False)
        p.add_argument("--root", default=".")
        p.add_argument("--format", choices=("text", "json"), default="text")
        if name == "check":
            p.add_argument("--component", action="append", default=[])
    sub.add_parser("generate", add_help=False).add_argument("--root", default=".")
    sub.add_parser("keys", add_help=False).add_argument("--json", action="store_true")
    return parser


def _render(report: Report, fmt: str, checked: int | None = None) -> str:
    return render_json(report) if fmt == "json" else render_text(report, checked)


def _run(args: argparse.Namespace, cwd: Path, out: TextIO, err: TextIO) -> int:
    if args.command == "check":
        result = check(cwd / args.root, args.component)
        known = {m.component.name for m in result.project.manifests}
        unknown = [c for c in args.component if c not in known]
        if unknown and not result.report.errors:
            raise UsageError(f"unknown component(s): {', '.join(unknown)}")
        out.write(_render(result.report, args.format, result.checked))
        return exit_code(result.report)
    if args.command == "validate":
        report, _ = validate_project(cwd / args.root)
        out.write(_render(report, args.format))
        return exit_code(report)
    if args.command == "generate":
        report, project = validate_project(cwd / args.root)
        if report.errors:
            err.write(render_text(Report(errors=report.errors)))
            return EXIT_CONFIG
        for item in generate(project, write=True):
            out.write(f"{'wrote' if item.stale else 'unchanged'}: {item.file}\n")
        return EXIT_OK
    if args.command == "keys":
        payload = {
            "adapter": ADAPTER,
            "schema_versions": list(SCHEMA_VERSIONS),
            "supported_keys": sorted(SUPPORTED_KEYS),
        }
        out.write(json.dumps(payload, indent=2) + "\n" if args.json else "\n".join(sorted(SUPPORTED_KEYS)) + "\n")
        return EXIT_OK
    raise UsageError("missing command")


def main(
    argv: Sequence[str] | None = None,
    *,
    cwd: Path | None = None,
    out: TextIO | None = None,
    err: TextIO | None = None,
) -> int:
    """Runs the CLI and returns the exit code (the console script exits with it)."""
    args_in = list(sys.argv[1:] if argv is None else argv)
    stdout = out or sys.stdout
    stderr = err or sys.stderr
    base = cwd or Path.cwd()
    name = args_in[0] if args_in else None
    if name is None or name in ("--help", "-h", "help"):
        stdout.write(USAGE)
        return EXIT_USAGE if name is None else EXIT_OK
    if name in ("--version", "-v"):
        stdout.write(f"{__version__}\n")
        return EXIT_OK
    if name in NODE_ONLY:
        stderr.write(f"{name} is provided by the Node CLI: npx boundaries {name}\n")
        return EXIT_USAGE
    try:
        return _run(_parser().parse_args(args_in), base, stdout, stderr)
    except UsageError as error:
        stderr.write(f"{error}\n\n{USAGE}")
        return EXIT_USAGE
    except Exception:
        stderr.write(f"internal error: {traceback.format_exc()}")
        return EXIT_INTERNAL
