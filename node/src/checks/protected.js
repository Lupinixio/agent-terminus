// [protected]: every provider and probe file must itself be protected, so an
// agent cannot quietly edit the code that reports what a component exposes.
// (Existence of protected paths is a config rule, checked when loading.)
import { matchGlob } from '../glob.js';
import { protectedGlobs } from '../index-file.js';
import { parseRef } from '../refs.js';

/**
 * @typedef {import('../types.js').Project} Project
 * @typedef {import('../types.js').Manifest} Manifest
 * @typedef {import('../types.js').Violation} Violation
 */

/**
 * Provider and probe references of a manifest with their keys.
 * @param {Manifest} manifest
 * @returns {{ key: string, ref: string }[]}
 */
export function providerRefs(manifest) {
  return [
    ...manifest.entrypoints.map((g, i) => ({ key: `entrypoints[${i}].provider`, ref: g.provider })),
    ...(manifest.bind ? [{ key: 'runtime.bind.provider', ref: manifest.bind.provider }] : []),
    ...(manifest.secrets ? [{ key: 'runtime.secrets.probe', ref: manifest.secrets.probe }] : []),
  ];
}

/**
 * @param {Project} project
 * @param {Manifest} manifest
 * @returns {Promise<Violation[]>}
 */
export async function checkProtected(project, manifest) {
  const globs = protectedGlobs(project);
  const nocase = process.platform === 'win32';
  /** @type {Violation[]} */
  const out = [];
  const seen = new Set();
  for (const { key, ref } of providerRefs(manifest)) {
    const file = parseRef(ref).file;
    if (seen.has(file)) continue;
    seen.add(file);
    if (!globs.some((g) => matchGlob(g, file, { nocase }))) {
      out.push({
        component: manifest.component.name,
        check: 'protected',
        key: 'protected.paths',
        location: null,
        message: `${file} (from ${key}) is not covered by protected.paths`,
      });
    }
  }
  return out;
}
