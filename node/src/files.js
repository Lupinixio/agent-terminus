// File-system helpers shared by the loader and the checks.
import { existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { globToRegExp, literalPrefix } from './glob.js';

/** Directories never walked. */
export const SKIP_DIRS = new Set(['node_modules', '.git', '.venv', '__pycache__', '.scratch', '.mypy_cache', '.ruff_cache', '.pytest_cache']);

/** @param {string} p */
export function toPosix(p) {
  return p.split(path.sep).join('/');
}

/**
 * Project-relative paths (forward slashes) of all files below `dir`.
 * @param {string} root
 * @param {string} [dir] project-relative start directory
 * @param {{ skip?: (rel: string) => boolean }} [options]
 * @returns {string[]}
 */
export function walkFiles(root, dir = '', options = {}) {
  /** @type {string[]} */
  const out = [];
  const start = path.join(root, dir);
  if (!existsSync(start)) return out;
  if (!statSync(start).isDirectory()) return [toPosix(path.relative(root, start))];
  /** @param {string} abs */
  const visit = (abs) => {
    for (const entry of readdirSync(abs, { withFileTypes: true })) {
      const child = path.join(abs, entry.name);
      const rel = toPosix(path.relative(root, child));
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        if (options.skip?.(rel)) continue;
        visit(child);
      } else if (entry.isFile()) {
        out.push(rel);
      }
    }
  };
  visit(start);
  return out.sort();
}

/**
 * Files matching a glob, searched below the glob's literal directory prefix.
 * @param {string} root
 * @param {string} glob
 * @returns {string[]}
 */
export function globFiles(root, glob) {
  const prefix = literalPrefix(glob);
  const dir = prefix.includes('/') ? prefix.slice(0, prefix.lastIndexOf('/')) : '';
  const re = globToRegExp(glob, { nocase: process.platform === 'win32' });
  return walkFiles(root, dir).filter((rel) => re.test(rel));
}
