// What the Node adapter checks. Pure.

/** Manifest schema versions this adapter understands. */
export const SCHEMA_VERSIONS = Object.freeze([1]);

/** Built-in protected paths (copy of schema/builtin-protected.json; cross-tested). */
export const BUILTIN_PROTECTED = Object.freeze([
  '.boundaries/**',
  '.claude/hooks/protect-boundaries.mjs',
  '.claude/settings.json',
  '.claude/settings.local.json',
  '.githooks/pre-commit',
  '.github/workflows/boundaries.yml',
  '.github/CODEOWNERS',
  'CODEOWNERS',
  'docs/CODEOWNERS',
]);

/**
 * Every manifest key path this adapter verifies. Arrays of tables are written
 * `key[].sub`. `component.package` is Python-only.
 */
export const SUPPORTED_KEYS = Object.freeze(
  [
    'schema_version',
    'component.name',
    'component.language',
    'component.root',
    'component.exclude',
    'component.principle',
    'component.decisions',
    'imports.internal',
    'imports.internal[].target',
    'imports.internal[].only_from',
    'imports.external',
    'imports.external[].target',
    'imports.external[].only_from',
    'imports.builtin',
    'imports.builtin[].target',
    'imports.builtin[].only_from',
    'calls.forbidden',
    'calls.forbidden[].pattern',
    'calls.forbidden[].reason',
    'entrypoints[].name',
    'entrypoints[].provider',
    'entrypoints[].exact',
    'runtime.bind.hosts',
    'runtime.bind.provider',
    'runtime.secrets.names',
    'runtime.secrets.probe',
    'protected.paths',
  ].sort(),
);

/** @param {unknown} value */
function isTable(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Leaf key paths present in a raw manifest.
 * @param {Record<string, unknown>} raw
 * @returns {string[]}
 */
export function keyPaths(raw) {
  /** @type {Set<string>} */
  const out = new Set();
  /**
   * @param {unknown} value
   * @param {string} path
   */
  const walk = (value, path) => {
    if (isTable(value)) {
      const entries = Object.entries(/** @type {Record<string, unknown>} */ (value));
      if (entries.length === 0 && path) out.add(path);
      for (const [key, child] of entries) walk(child, path ? `${path}.${key}` : key);
    } else if (Array.isArray(value)) {
      if (value.length === 0 || value.some((item) => !isTable(item))) out.add(path);
      for (const item of value) if (isTable(item)) walk(item, `${path}[]`);
    } else {
      out.add(path);
    }
  };
  walk(raw, '');
  return [...out].sort();
}

/**
 * Key paths in a raw manifest that this adapter does not check.
 * @param {Record<string, unknown>} raw
 * @returns {string[]}
 */
export function unsupportedKeys(raw) {
  const supported = new Set(SUPPORTED_KEYS);
  return keyPaths(raw).filter((key) => !supported.has(key));
}
