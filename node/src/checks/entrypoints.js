// [[entrypoints]]: the provider's set must equal `exact`.
import { ConfigError } from '../errors.js';
import { resolveRef } from '../refs.js';

/**
 * @typedef {import('../types.js').Project} Project
 * @typedef {import('../types.js').Manifest} Manifest
 * @typedef {import('../types.js').Violation} Violation
 */

/** @param {string} entry */
export function normalizeEntry(entry) {
  return entry.trim().replace(/\s+/g, ' ');
}

/**
 * Calls a provider and returns its strings, or throws ConfigError.
 * @param {Project} project
 * @param {Manifest} manifest
 * @param {string} ref
 * @param {string} key
 * @returns {Promise<string[]>}
 */
export async function callProvider(project, manifest, ref, key) {
  let value;
  try {
    const fn = await resolveRef(project.root, ref);
    value = await fn();
  } catch (error) {
    throw new ConfigError(manifest.file, key, `provider ${ref} failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (typeof value === 'string' || value === null || value === undefined || typeof value !== 'object' || !(Symbol.iterator in value)) {
    throw new ConfigError(manifest.file, key, `provider ${ref} must return an iterable of strings`);
  }
  const items = [...(/** @type {Iterable<unknown>} */ (value))];
  if (!items.every((i) => typeof i === 'string')) {
    throw new ConfigError(manifest.file, key, `provider ${ref} must return an iterable of strings`);
  }
  return /** @type {string[]} */ (items);
}

/**
 * Missing and extra entries between a declared and an actual set.
 * @param {string[]} declared
 * @param {Iterable<string>} actual
 */
export function compareEntrypoints(declared, actual) {
  const want = new Set(declared.map(normalizeEntry));
  const have = new Set([...actual].map(normalizeEntry));
  return {
    missing: [...want].filter((e) => !have.has(e)).sort(),
    extra: [...have].filter((e) => !want.has(e)).sort(),
  };
}

/**
 * @param {Project} project
 * @param {Manifest} manifest
 * @returns {Promise<Violation[]>}
 */
export async function checkEntrypoints(project, manifest) {
  /** @type {Violation[]} */
  const out = [];
  for (const [index, group] of manifest.entrypoints.entries()) {
    const key = `entrypoints[${index}].exact`;
    const actual = await callProvider(project, manifest, group.provider, `entrypoints[${index}].provider`);
    const { missing, extra } = compareEntrypoints(group.exact, actual);
    const base = { component: manifest.component.name, check: /** @type {const} */ ('entrypoints'), key, location: null };
    for (const e of extra) out.push({ ...base, message: `${group.name}: "${e}" is exposed but not declared` });
    for (const e of missing) out.push({ ...base, message: `${group.name}: "${e}" is declared but not exposed` });
  }
  return out;
}
