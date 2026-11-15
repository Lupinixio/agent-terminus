// Decision records linked from a manifest or kit.toml must exist. A missing
// record is a config error (exit 3), reported while loading the project.
import { existsSync } from 'node:fs';
import path from 'node:path';

/** @typedef {import('../types.js').Problem} Problem */

/**
 * @param {string} root
 * @param {string[]} decisions
 * @param {string} file manifest or kit.toml that lists them
 * @param {string} key key of the list (`component.decisions` or `decisions`)
 * @returns {Problem[]}
 */
export function decisionProblems(root, decisions, file, key) {
  return decisions.flatMap((d, i) =>
    existsSync(path.join(root, d)) ? [] : [{ file, key: `${key}[${i}]`, message: `decision file ${d} does not exist` }],
  );
}
