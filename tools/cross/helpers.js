// Helpers for the cross-adapter tests. They need both environments:
// `npm ci` and `uv sync --project python`.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const NODE_BIN = path.join(REPO, 'node/bin/boundaries.mjs');
export const PYTHON = path.join(REPO, 'python/.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');

/** Project roots both adapters must agree on. */
export const ROOTS = Object.freeze([
  '.',
  'fixtures/python/passing',
  'fixtures/python/violating',
  'fixtures/node/passing',
  'fixtures/node/violating',
  'examples/web-dashboard',
]);

/** @typedef {{ code: number | null, stdout: string, stderr: string }} Run */

function requirePython() {
  if (!existsSync(PYTHON)) throw new Error(`${PYTHON} is missing; run: uv sync --project python`);
}

/**
 * Runs the Node CLI.
 * @param {string[]} args
 * @returns {Run}
 */
export function runNode(args) {
  const r = spawnSync(process.execPath, [NODE_BIN, ...args], { cwd: REPO, encoding: 'utf8' });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
}

/**
 * Runs the Python CLI (`python -m agent_terminus`).
 * @param {string[]} args
 * @returns {Run}
 */
export function runPython(args) {
  requirePython();
  const r = spawnSync(PYTHON, ['-m', 'agent_terminus', ...args], { cwd: REPO, encoding: 'utf8' });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
}

/**
 * Runs a Python snippet with the adapter importable; returns stdout bytes as UTF-8.
 * @param {string} code
 * @param {string[]} [args]
 */
export function pythonEval(code, args = []) {
  requirePython();
  const r = spawnSync(PYTHON, ['-c', code, ...args], { cwd: REPO, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`python failed: ${r.stderr}`);
  return r.stdout;
}

/**
 * Leaf key paths a JSON schema accepts, written like SUPPORTED_KEYS
 * (`a.b`, arrays of tables as `a[].b`).
 * @param {any} schema root schema
 */
export function schemaLeafKeys(schema) {
  /** @type {Set<string>} */
  const out = new Set();
  /** @param {any} node */
  const deref = (node) => {
    let current = node;
    while (current && typeof current.$ref === 'string') {
      const name = current.$ref.replace('#/$defs/', '');
      current = schema.$defs[name];
    }
    return current;
  };
  /** @param {any} node @returns {any[]} */
  const variants = (node) => {
    const n = deref(node);
    if (!n) return [];
    if (Array.isArray(n.oneOf)) return n.oneOf.flatMap(variants);
    if (Array.isArray(n.anyOf)) return n.anyOf.flatMap(variants);
    return [n];
  };
  /**
   * @param {any} node
   * @param {string} at
   */
  const walk = (node, at) => {
    for (const v of variants(node)) {
      if (v.type === 'object' && v.properties) {
        for (const [key, child] of Object.entries(v.properties)) walk(child, at ? `${at}.${key}` : key);
      } else if (v.type === 'array') {
        const items = variants(v.items ?? {});
        if (items.length === 0 || items.some((i) => i.type !== 'object')) out.add(at);
        for (const item of items) {
          if (item.type === 'object' && item.properties) {
            for (const [key, child] of Object.entries(item.properties)) walk(child, `${at}[].${key}`);
          }
        }
      } else {
        out.add(at);
      }
    }
  };
  walk(schema, '');
  return [...out].sort();
}
