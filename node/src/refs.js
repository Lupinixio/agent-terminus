// Resolves `./path.js#export` references to functions (runs project code).
import { existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Splits a Node reference into its project-relative file and export name.
 * @param {string} ref
 * @returns {{ file: string, exportName: string }}
 */
export function parseRef(ref) {
  const hash = ref.lastIndexOf('#');
  return { file: ref.slice(2, hash), exportName: ref.slice(hash + 1) };
}

/**
 * @param {string} root
 * @param {string} ref
 * @returns {Promise<(...args: unknown[]) => unknown>}
 * @throws {Error} with a readable message when the file or export is missing
 */
export async function resolveRef(root, ref) {
  const { file, exportName } = parseRef(ref);
  const abs = path.join(root, file);
  if (!existsSync(abs)) throw new Error(`${ref}: file ${file} does not exist`);
  /** @type {Record<string, unknown>} */
  let mod;
  try {
    mod = await import(pathToFileURL(abs).href);
  } catch (error) {
    throw new Error(`${ref}: cannot import ${file}: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
  const fn = mod[exportName];
  if (typeof fn !== 'function') throw new Error(`${ref}: ${file} has no exported function ${exportName}`);
  return /** @type {(...args: unknown[]) => unknown} */ (fn);
}
