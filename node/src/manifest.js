// Loads `.boundaries/` (kit.toml and every component manifest) and applies the
// adapter rules beyond the schema. Reads files; runs no project code.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { parse as parseToml } from 'smol-toml';
import { hasGlobChars } from './glob.js';
import { globFiles } from './files.js';
import { defaultKit, kitFromRaw } from './kit-config.js';
import { unsupportedKeys } from './support.js';
import { validateKit, validateManifest } from './validate.js';

/**
 * @typedef {import('./types.js').Manifest} Manifest
 * @typedef {import('./types.js').Project} Project
 * @typedef {import('./types.js').Problem} Problem
 * @typedef {import('./types.js').AllowList} AllowList
 */

export const ADAPTER = 'node';
export const BOUNDARIES_DIR = '.boundaries';

const NODE_SYNTAX = {
  ref: /^\.\/[^#]+#[A-Za-z_$][\w$]*$/,
  path: /^(?![/\\])(?![A-Za-z]:)(?!(?:.*\/)?\.\.(?:\/|$))[^*?[\]{}\\]+$/,
  external: /^(@[a-z0-9][\w.-]*\/)?[A-Za-z0-9][\w.-]*$/,
  builtin: /^(?!node:)[a-z_][a-z0-9_]*(\/[a-z0-9_]+)*$/,
};

/**
 * @param {unknown} value
 * @returns {AllowList}
 */
function allowFromRaw(value) {
  if (value === 'any') return 'any';
  return /** @type {unknown[]} */ (value).map((item) =>
    typeof item === 'string'
      ? { target: item, onlyFrom: null }
      : {
          target: /** @type {any} */ (item).target,
          onlyFrom: /** @type {any} */ (item).only_from,
        },
  );
}

/**
 * Builds a Manifest from a raw table that passed schema validation.
 * @param {Record<string, any>} raw
 * @param {string} file project-relative manifest path
 * @returns {Manifest}
 */
export function manifestFromRaw(raw, file) {
  const comp = raw.component;
  return {
    file,
    raw,
    component: {
      name: comp.name,
      language: comp.language,
      root: comp.root.replace(/\/+$/, ''),
      package: comp.package ?? null,
      exclude: comp.exclude ?? [],
      principle: comp.principle,
      decisions: comp.decisions,
    },
    imports: raw.imports
      ? {
          internal: allowFromRaw(raw.imports.internal),
          external: allowFromRaw(raw.imports.external),
          builtin: allowFromRaw(raw.imports.builtin),
        }
      : null,
    calls: raw.calls
      ? raw.calls.forbidden.map((/** @type {any} */ item) =>
          typeof item === 'string' ? { pattern: item, reason: null } : { pattern: item.pattern, reason: item.reason ?? null },
        )
      : null,
    entrypoints: (raw.entrypoints ?? []).map((/** @type {any} */ g) => ({ name: g.name, provider: g.provider, exact: g.exact })),
    bind: raw.runtime?.bind ? { hosts: raw.runtime.bind.hosts, provider: raw.runtime.bind.provider } : null,
    secrets: raw.runtime?.secrets ? { names: raw.runtime.secrets.names, probe: raw.runtime.secrets.probe } : null,
    protected: raw.protected?.paths ?? [],
  };
}

/**
 * Reads and parses a TOML file.
 * @param {string} abs
 * @param {string} rel
 * @returns {{ raw: unknown } | { problem: Problem }}
 */
function readToml(abs, rel) {
  try {
    return { raw: parseToml(readFileSync(abs, 'utf8')) };
  } catch (error) {
    const message = error instanceof Error ? error.message.split('\n')[0] : String(error);
    return { problem: { file: rel, key: '', message: `TOML parse error: ${message}` } };
  }
}

/**
 * @param {string} root
 * @param {string} rel
 */
function exists(root, rel) {
  return existsSync(path.join(root, rel));
}

/**
 * Language-agnostic adapter rules: file stem, decision files, component root,
 * protected paths.
 * @param {string} root
 * @param {Manifest} m
 * @returns {Problem[]}
 */
function commonRules(root, m) {
  /** @type {Problem[]} */
  const problems = [];
  const stem = path.posix.basename(m.file, '.toml');
  if (m.component.name !== stem) {
    problems.push({ file: m.file, key: 'component.name', message: `name "${m.component.name}" must equal the file name "${stem}"` });
  }
  m.component.decisions.forEach((d, i) => {
    if (!exists(root, d)) problems.push({ file: m.file, key: `component.decisions[${i}]`, message: `decision file ${d} does not exist` });
  });
  const rootAbs = path.join(root, m.component.root);
  if (!existsSync(rootAbs) || !statSync(rootAbs).isDirectory()) {
    problems.push({ file: m.file, key: 'component.root', message: `component root ${m.component.root} is not a directory` });
  }
  m.protected.forEach((p, i) => problems.push(...protectedPathProblems(root, p, m.file, `protected.paths[${i}]`)));
  return problems;
}

/**
 * A non-glob protected path must exist; a glob must match at least one file.
 * @param {string} root
 * @param {string} p
 * @param {string} file
 * @param {string} key
 * @returns {Problem[]}
 */
export function protectedPathProblems(root, p, file, key) {
  if (hasGlobChars(p)) {
    return globFiles(root, p).length === 0 ? [{ file, key, message: `protected glob ${p} matches no file` }] : [];
  }
  return exists(root, p) ? [] : [{ file, key, message: `protected path ${p} does not exist` }];
}

/**
 * Node-specific adapter rules: support set, reference and target syntax.
 * @param {Manifest} m
 * @returns {Problem[]}
 */
export function nodeRules(m) {
  /** @type {Problem[]} */
  const problems = [];
  for (const key of unsupportedKeys(m.raw)) {
    problems.push({ file: m.file, key, message: `key ${key} is not checked by the ${ADAPTER} adapter` });
  }
  /** @param {string} key @param {string} ref */
  const ref = (key, ref) => {
    if (!NODE_SYNTAX.ref.test(ref)) problems.push({ file: m.file, key, message: `"${ref}" is not a Node reference (./path.js#export)` });
  };
  m.entrypoints.forEach((g, i) => ref(`entrypoints[${i}].provider`, g.provider));
  if (m.bind) ref('runtime.bind.provider', m.bind.provider);
  if (m.secrets) ref('runtime.secrets.probe', m.secrets.probe);
  if (m.imports) {
    for (const kind of /** @type {const} */ (['internal', 'external', 'builtin'])) {
      const list = m.imports[kind];
      if (list === 'any') continue;
      const syntax = kind === 'internal' ? NODE_SYNTAX.path : NODE_SYNTAX[kind];
      list.forEach((entry, i) => {
        const key = `imports.${kind}[${i}]`;
        if (!syntax.test(entry.target)) {
          problems.push({ file: m.file, key, message: `"${entry.target}" is not a valid Node ${kind} target` });
        }
        (entry.onlyFrom ?? []).forEach((from, j) => {
          if (!NODE_SYNTAX.path.test(from)) {
            problems.push({ file: m.file, key: `${key}.only_from[${j}]`, message: `"${from}" is not a project-relative path` });
          }
        });
      });
    }
  }
  return problems;
}

/**
 * Loads kit.toml and every manifest under `<root>/.boundaries/`.
 * `problems` holds every config error (exit 3) for this adapter.
 * @param {string} root
 * @returns {Promise<Project>}
 */
export async function loadProject(root) {
  const absRoot = path.resolve(root);
  /** @type {Problem[]} */
  const problems = [];
  let kit = defaultKit();
  /** @type {Manifest[]} */
  const manifests = [];
  const dir = path.join(absRoot, BOUNDARIES_DIR);
  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    problems.push({ file: BOUNDARIES_DIR, key: '', message: `no ${BOUNDARIES_DIR}/ directory under ${absRoot} (run boundaries init)` });
    return { root: absRoot, kit, manifests, problems };
  }
  const names = readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith('.toml'))
    .map((e) => e.name)
    .sort();
  for (const name of names) {
    const rel = `${BOUNDARIES_DIR}/${name}`;
    const parsed = readToml(path.join(dir, name), rel);
    if ('problem' in parsed) {
      problems.push(parsed.problem);
      continue;
    }
    if (name === 'kit.toml') {
      const kitProblems = validateKit(parsed.raw, rel);
      problems.push(...kitProblems);
      if (kitProblems.length === 0) {
        kit = kitFromRaw(/** @type {Record<string, any>} */ (parsed.raw), rel);
        kit.decisions.forEach((d, i) => {
          if (!exists(absRoot, d)) problems.push({ file: rel, key: `decisions[${i}]`, message: `decision file ${d} does not exist` });
        });
        kit.protected.forEach((p, i) => problems.push(...protectedPathProblems(absRoot, p, rel, `protected.paths[${i}]`)));
        if (kit.nodeTsconfig && !exists(absRoot, kit.nodeTsconfig)) {
          problems.push({ file: rel, key: 'node.tsconfig', message: `${kit.nodeTsconfig} does not exist` });
        }
      }
      continue;
    }
    const schemaProblems = validateManifest(parsed.raw, rel);
    if (schemaProblems.length > 0) {
      problems.push(...schemaProblems);
      continue;
    }
    const manifest = manifestFromRaw(/** @type {Record<string, any>} */ (parsed.raw), rel);
    problems.push(...commonRules(absRoot, manifest));
    if (manifest.component.language === ADAPTER) problems.push(...nodeRules(manifest));
    manifests.push(manifest);
  }
  return { root: absRoot, kit, manifests, problems };
}
