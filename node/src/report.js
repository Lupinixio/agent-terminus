// Report shape, renderers and exit codes. Pure.

/**
 * @typedef {import('./types.js').Report} Report
 * @typedef {import('./types.js').Violation} Violation
 */

export const EXIT = Object.freeze({ OK: 0, VIOLATIONS: 1, USAGE: 2, CONFIG: 3, STALE: 4, INTERNAL: 70 });

/** @returns {Report} */
export function emptyReport() {
  return { schema_version: 1, adapter: 'node', results: [], skipped: [], stale: [], errors: [] };
}

/**
 * Exit code for a report: config errors, then violations, then stale files.
 * @param {Report} report
 */
export function exitCode(report) {
  if (report.errors.length > 0) return EXIT.CONFIG;
  if (report.results.length > 0) return EXIT.VIOLATIONS;
  if (report.stale.length > 0) return EXIT.STALE;
  return EXIT.OK;
}

/** @param {Report} report */
export function renderJson(report) {
  return `${JSON.stringify(report, null, 2)}\n`;
}

/**
 * @param {Report} report
 * @param {{ checked?: number }} [info]
 */
export function renderText(report, info = {}) {
  /** @type {string[]} */
  const lines = [];
  for (const e of report.errors) lines.push(`${e.file}: ${e.message}${e.key ? ` [${e.key}]` : ''}`);
  for (const r of report.results) {
    lines.push(`${r.component} ${r.check}${r.location ? ` ${r.location}` : ''}: ${r.message} [${r.key}]`);
  }
  for (const s of report.stale) lines.push(`stale: ${s} (run boundaries generate)`);
  for (const s of report.skipped) lines.push(`skipped: ${s.component} (${s.reason})`);
  const code = exitCode(report);
  const checked = info.checked === undefined ? '' : `, ${info.checked} component(s) checked`;
  const summary =
    code === EXIT.OK
      ? `boundaries (${report.adapter}): ok${checked}, ${report.skipped.length} skipped`
      : `boundaries (${report.adapter}): ${report.errors.length} config error(s), ${report.results.length} violation(s), ` +
        `${report.stale.length} stale file(s)${checked}, ${report.skipped.length} skipped`;
  lines.push(summary);
  return `${lines.join('\n')}\n`;
}
