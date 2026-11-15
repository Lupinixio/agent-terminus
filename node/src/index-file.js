// `.boundaries/generated/index.json`: the hook's input. Pure; byte-identical
// to the Python adapter's output (cross-tested).
import { BUILTIN_PROTECTED } from './support.js';

/** @typedef {import('./types.js').Project} Project */

export const INDEX_PATH = '.boundaries/generated/index.json';

/**
 * Serializes a JSON value with sorted keys, 2-space indent, LF and a trailing newline.
 * @param {unknown} value
 * @returns {string}
 */
export function canonicalJson(value) {
  /** @param {unknown} v @returns {unknown} */
  const sort = (v) => {
    if (Array.isArray(v)) return v.map(sort);
    if (v && typeof v === 'object') {
      return Object.fromEntries(
        Object.keys(v)
          .sort()
          .map((k) => [k, sort(/** @type {Record<string, unknown>} */ (v)[k])]),
      );
    }
    return v;
  };
  return `${JSON.stringify(sort(value), null, 2)}\n`;
}

/**
 * Sorted, de-duplicated protected globs: built-ins, kit.toml and every manifest
 * (all languages).
 * @param {Project} project
 * @returns {string[]}
 */
export function protectedGlobs(project) {
  const all = new Set([...BUILTIN_PROTECTED, ...project.kit.protected, ...project.manifests.flatMap((m) => m.protected)]);
  return [...all].sort();
}

/**
 * @param {Project} project
 * @returns {string}
 */
export function buildIndex(project) {
  return canonicalJson({ schema_version: 1, decision: project.kit.hookDecision, protected: protectedGlobs(project) });
}
