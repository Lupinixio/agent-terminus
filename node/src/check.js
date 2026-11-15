// `boundaries check`: validate, run every check for Node components, verify
// generated files. Checks return violations; only the CLI picks exit codes.
import { generateFiles } from './generate.js';
import { ADAPTER, loadProject } from './manifest.js';
import { emptyReport } from './report.js';

/**
 * @typedef {import('./types.js').Report} Report
 * @typedef {import('./types.js').Project} Project
 * @typedef {import('./types.js').Manifest} Manifest
 * @typedef {import('./types.js').Violation} Violation
 */

/**
 * Raised by a check when the project's configuration or sources make the check
 * impossible (exit 3).
 */
export class ConfigError extends Error {
  /**
   * @param {string} file
   * @param {string} key
   * @param {string} message
   */
  constructor(file, key, message) {
    super(message);
    this.file = file;
    this.key = key;
  }
}

/** @type {((project: Project, manifest: Manifest) => Promise<Violation[]>)[]} */
const CHECKS = [];

/**
 * @param {{ root?: string, components?: string[] }} [options]
 * @returns {Promise<{ report: Report, checked: number, project: Project }>}
 */
export async function check(options = {}) {
  const project = await loadProject(options.root ?? '.');
  const report = emptyReport();
  report.errors.push(...project.problems);
  const own = project.manifests.filter((m) => m.component.language === ADAPTER);
  for (const m of project.manifests) {
    if (m.component.language !== ADAPTER) {
      report.skipped.push({ component: m.component.name, reason: `language ${m.component.language} is checked by its own adapter` });
    }
  }
  if (report.errors.length > 0) return { report, checked: 0, project };
  const selected = options.components?.length ? own.filter((m) => options.components?.includes(m.component.name)) : own;
  for (const manifest of selected) {
    for (const run of CHECKS) {
      try {
        report.results.push(...(await run(project, manifest)));
      } catch (error) {
        if (!(error instanceof ConfigError)) throw error;
        report.errors.push({ file: error.file, key: error.key, message: error.message });
      }
    }
  }
  if (report.errors.length > 0) return { report, checked: selected.length, project };
  for (const { file, stale } of generateFiles({ project, write: false })) if (stale) report.stale.push(file);
  return { report, checked: selected.length, project };
}
