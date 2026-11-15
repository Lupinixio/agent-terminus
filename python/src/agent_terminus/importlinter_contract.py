"""import-linter custom contract type that delegates to the kit's own import scanner.

Consumer config (pyproject.toml)::

    [tool.importlinter]
    root_packages = ["orders"]
    contract_types = ["boundaries: agent_terminus.importlinter_contract.BoundaryContract"]

    [[tool.importlinter.contracts]]
    name = "Component boundaries"
    type = "boundaries"
    # manifests = ".boundaries"   (default; relative to the working directory)

import-linter has no allow-list contract, and generated ``forbidden`` contracts would
have to list every other module and would drift. Delegating keeps one implementation:
``lint-imports`` and ``boundaries check`` cannot disagree. The grimp graph is ignored.
Needs the ``importlinter`` extra.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from importlinter import Contract, ContractCheck, fields, output

from .checks import ConfigError
from .checks.imports import check_imports
from .manifest import ADAPTER, load_project


class BoundaryContract(Contract):
    manifests = fields.StringField(default=".boundaries")

    def check(self, graph: Any, verbose: bool) -> ContractCheck:
        directory = Path(str(self.manifests)).resolve()
        project = load_project(directory.parent)
        errors = [f"{p.file}: {p.message}" + (f" [{p.key}]" if p.key else "") for p in project.problems]
        violations = []
        if not errors:
            for manifest in project.manifests:
                if manifest.component.language != ADAPTER:
                    continue
                try:
                    violations += check_imports(project, manifest)
                except ConfigError as error:
                    errors.append(f"{error.file}: {error.message} [{error.key}]")
        lines = [f"{v.component} {v.location}: {v.message} [{v.key}]" for v in violations]
        return ContractCheck(kept=not errors and not lines, metadata={"errors": errors, "violations": lines})

    def render_broken_contract(self, check: ContractCheck) -> None:
        for line in check.metadata["errors"]:
            output.print_error(f"config error: {line}")
        for line in check.metadata["violations"]:
            output.print_error(line)
        output.new_line()
