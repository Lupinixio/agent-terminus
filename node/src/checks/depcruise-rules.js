// Pure translation of a Node manifest's [imports] into dependency-cruiser
// `forbidden` rules. Paths are project-relative (dependency-cruiser runs with
// the project root as working directory).
import { globSource } from '../glob.js';

/**
 * @typedef {import('../types.js').Manifest} Manifest
 * @typedef {import('../types.js').AllowEntry} AllowEntry
 * @typedef {{ path?: string | string[], pathNot?: string[] }} FromSpec
 * @typedef {{ path?: string, pathNot?: string[], dependencyTypes?: readonly string[], dependencyTypesNot?: readonly string[], couldNotResolve?: boolean }} ToSpec
 * @typedef {{ name: string, severity: 'error', comment: string, from: FromSpec, to: ToSpec }} DepcruiseRule
 */

export const NPM_TYPES = Object.freeze(['npm', 'npm-dev', 'npm-optional', 'npm-peer', 'npm-bundled', 'npm-no-pkg', 'npm-unknown']);
const NOT_LOCAL = ['core', ...NPM_TYPES];

/** @param {string} text */
function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Regex for a project-relative file or directory and everything below it.
 * @param {string} p
 */
export function pathRegex(p) {
  const clean = p.replace(/\/+$/, '');
  return clean === '.' || clean === '' ? '^' : `^${escapeRegExp(clean)}(/|$)`;
}

/** @param {string} pkg */
export function packageRegex(pkg) {
  return `(^|/)node_modules/${escapeRegExp(pkg)}/`;
}

/** @param {string} name */
export function builtinRegex(name) {
  return `^${escapeRegExp(name)}(/|$)`;
}

/**
 * @param {Manifest} manifest
 * @returns {DepcruiseRule[]}
 */
export function toDepcruiseRules(manifest) {
  if (!manifest.imports) return [];
  const { name, root, exclude } = manifest.component;
  const prefix = `boundaries/${name}`;
  const fromRoot = pathRegex(root);
  const excludes = exclude.map((g) => `^${globSource(g)}$`);
  /** @param {string[]} [extra] @returns {FromSpec} */
  const from = (extra = []) => {
    const pathNot = [...excludes, ...extra];
    return pathNot.length > 0 ? { path: fromRoot, pathNot } : { path: fromRoot };
  };
  /** @type {DepcruiseRule[]} */
  const rules = [];
  const kinds = /** @type {const} */ ([
    ['internal', pathRegex, { dependencyTypesNot: NOT_LOCAL, couldNotResolve: false }],
    ['external', packageRegex, { dependencyTypes: [...NPM_TYPES] }],
    ['builtin', builtinRegex, { dependencyTypes: ['core'] }],
  ]);
  for (const [kind, toRegex, typeFilter] of kinds) {
    const list = manifest.imports[kind];
    if (list === 'any') continue;
    const allowed = list.map((e) => toRegex(e.target));
    if (kind === 'internal') allowed.unshift(fromRoot);
    rules.push({
      name: `${prefix}/${kind}`,
      severity: 'error',
      comment: `${manifest.file}: imports.${kind} does not allow this import`,
      from: from(),
      to: { ...typeFilter, pathNot: allowed },
    });
    list.forEach((entry, index) => {
      if (!entry.onlyFrom) return;
      rules.push({
        name: `${prefix}/${kind}-only-from-${index}`,
        severity: 'error',
        comment: `${manifest.file}: imports.${kind} allows ${entry.target} only from ${entry.onlyFrom.join(', ')}`,
        from: from(entry.onlyFrom.map(pathRegex)),
        to: { ...typeFilter, path: toRegex(entry.target) },
      });
    });
  }
  rules.push({
    name: `${prefix}/unresolvable`,
    severity: 'error',
    comment: `${manifest.file}: every import must resolve so the import limits can be checked`,
    from: from(),
    to: { couldNotResolve: true },
  });
  return rules;
}
