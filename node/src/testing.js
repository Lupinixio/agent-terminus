// Test helpers for projects that use the kit (vitest, node:test, jest...).
// Framework-agnostic: failures throw node:assert's AssertionError listing every
// finding. These are extras on top of `boundaries check`, not substitutes.
import { AssertionError } from 'node:assert';
import path from 'node:path';
import { check } from './check.js';
import { compareEntrypoints } from './checks/entrypoints.js';
import { plantEnv } from './env.js';
import { loadProject } from './manifest.js';
import { findLeaks, makeSentinel } from './sentinels.js';

/**
 * @typedef {import('./types.js').Manifest} Manifest
 * @typedef {import('./types.js').Report} Report
 */

/** @param {string} message */
function fail(message) {
  throw new AssertionError({ message, operator: 'boundaries' });
}

/**
 * Asserts that `actual` equals a manifest's entrypoint group exactly.
 * @param {Manifest | string} manifest a loaded manifest or a component name (loaded from cwd)
 * @param {Iterable<string>} actual
 * @param {string} [group]
 */
export async function assertEntrypoints(manifest, actual, group = 'http') {
  let m = manifest;
  if (typeof m === 'string') {
    const name = m;
    const project = await loadProject(process.cwd());
    const found = project.manifests.find((x) => x.component.name === name);
    if (!found) fail(`no manifest for component ${name} under ${path.join(process.cwd(), '.boundaries')}`);
    m = /** @type {Manifest} */ (found);
  }
  const g = m.entrypoints.find((x) => x.name === group);
  if (!g) fail(`${m.file} has no entrypoint group "${group}"`);
  const { missing, extra } = compareEntrypoints(/** @type {{ exact: string[] }} */ (g).exact, actual);
  const problems = [...extra.map((e) => `exposed but not declared: ${e}`), ...missing.map((e) => `declared but not exposed: ${e}`)];
  if (problems.length > 0) fail(`entrypoints "${group}" of ${m.component.name} differ:\n${problems.join('\n')}`);
}

/**
 * Plants a fresh sentinel per name in the process environment while `fn` runs.
 * @template T
 * @param {string[]} names
 * @param {(sentinels: Record<string, string>) => T | Promise<T>} fn
 * @returns {Promise<T>}
 */
export async function withSecretSentinels(names, fn) {
  /** @type {Record<string, string>} */
  const sentinels = Object.fromEntries(names.map((n) => [n, makeSentinel()]));
  const restore = plantEnv(sentinels);
  try {
    return await fn(sentinels);
  } finally {
    restore();
  }
}

/**
 * Asserts that no sentinel (in any searched encoding) appears in the texts.
 * @param {Iterable<string>} texts
 * @param {Record<string, string>} sentinels
 */
export function assertNoSecret(texts, sentinels) {
  const list = [...texts].map((text, i) => ({ source: `text #${i}`, text }));
  const leaks = findLeaks(list, sentinels);
  if (leaks.length > 0) fail(`secrets leaked:\n${leaks.map((l) => `${l.name} in ${l.source} (${l.form})`).join('\n')}`);
}

/**
 * Runs the full Node check and returns its report.
 * @param {{ root?: string }} [options]
 * @returns {Promise<Report>}
 */
export async function checkBoundaries(options = {}) {
  return (await check({ root: options.root ?? '.' })).report;
}
