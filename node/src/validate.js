// Hand-written validators mirroring schema/manifest.schema.json and
// schema/kit.schema.json. Pure. Held to the schemas by the conformance corpus
// in schema/fixtures (see node/test/validate-conformance.test.js).

/** @typedef {import('./types.js').Problem} Problem */

export const PATTERNS = Object.freeze({
  name: /^(?!kit$)[a-z][a-z0-9-]{0,62}$/,
  relPath: /^(?![/\\])(?![A-Za-z]:)(?!(?:.*[/\\])?\.\.(?:[/\\]|$))[^*?[\]{}]+$/,
  relGlob: /^(?![/\\])(?![A-Za-z]:)(?!(?:.*[/\\])?\.\.(?:[/\\]|$))[^[\]{}]+$/,
  dotted: /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$/,
  ref: /^([A-Za-z_]\w*(\.[A-Za-z_]\w*)*:[A-Za-z_]\w*|\.\/[^#]+#[A-Za-z_$][\w$]*)$/,
  callPattern: /^(\*\.)?[A-Za-z_$*][\w$*]*(\.[A-Za-z_$*][\w$*]*)*$/,
  entrypointName: /^[a-z][a-z0-9-]*$/,
  secretName: /^[A-Za-z_][A-Za-z0-9_]*$/,
});

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function isTable(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** @param {string} text */
function codePoints(text) {
  return [...text].length;
}

class Collector {
  /** @param {string} file */
  constructor(file) {
    this.file = file;
    /** @type {Problem[]} */
    this.problems = [];
  }

  /** @param {string} key @param {string} message */
  add(key, message) {
    this.problems.push({ file: this.file, key, message });
  }

  /**
   * Reports keys not in `allowed` and missing `required` keys.
   * @param {Record<string, unknown>} table
   * @param {string} path
   * @param {string[]} allowed
   * @param {string[]} required
   */
  shape(table, path, allowed, required) {
    for (const key of Object.keys(table)) {
      if (!allowed.includes(key)) this.add(join(path, key), `unknown key "${key}"`);
    }
    for (const key of required) {
      if (!(key in table)) this.add(join(path, key), 'is required');
    }
  }

  /** @param {unknown} value @param {string} key @param {RegExp} pattern @param {string} what */
  patterned(value, key, pattern, what) {
    if (typeof value !== 'string') this.add(key, `must be a string (${what})`);
    else if (!pattern.test(value)) this.add(key, `${JSON.stringify(value)} is not a valid ${what}`);
  }

  /** @param {unknown} value @param {string} key @param {number} [minLength] */
  string(value, key, minLength = 1) {
    if (typeof value !== 'string') this.add(key, 'must be a string');
    else if (codePoints(value) < minLength) this.add(key, 'must not be empty');
  }

  /**
   * @param {unknown} value
   * @param {string} key
   * @param {{ minItems?: number, unique?: boolean }} opts
   * @param {(item: unknown, key: string) => void} each
   */
  array(value, key, opts, each) {
    if (!Array.isArray(value)) {
      this.add(key, 'must be an array');
      return;
    }
    if (opts.minItems !== undefined && value.length < opts.minItems) {
      this.add(key, `must have at least ${opts.minItems} item(s)`);
    }
    if (opts.unique) {
      const seen = new Set();
      for (const item of value) {
        const id = JSON.stringify(item);
        if (seen.has(id)) this.add(key, `duplicate item ${id}`);
        seen.add(id);
      }
    }
    value.forEach((item, index) => each(item, `${key}[${index}]`));
  }

  /** @param {unknown} value @param {string} key */
  table(value, key) {
    if (!isTable(value)) {
      this.add(key, 'must be a table');
      return false;
    }
    return true;
  }
}

/** @param {string} path @param {string} key */
function join(path, key) {
  return path ? `${path}.${key}` : key;
}

/** @param {Collector} c @param {unknown} value @param {string} key */
function allowList(c, value, key) {
  if (value === 'any') return;
  if (!Array.isArray(value)) {
    c.add(key, 'must be "any" or an array of targets');
    return;
  }
  c.array(value, key, {}, (item, itemKey) => {
    if (typeof item === 'string') {
      c.string(item, itemKey);
      return;
    }
    if (!isTable(item)) {
      c.add(itemKey, 'must be a string or a { target, only_from } table');
      return;
    }
    c.shape(item, itemKey, ['target', 'only_from'], ['target', 'only_from']);
    if ('target' in item) c.string(item.target, `${itemKey}.target`);
    if ('only_from' in item) {
      c.array(item.only_from, `${itemKey}.only_from`, { minItems: 1 }, (from, fromKey) => c.string(from, fromKey));
    }
  });
}

/**
 * Validates a parsed manifest against the manifest schema (schema rules only).
 * @param {unknown} raw
 * @param {string} file
 * @returns {Problem[]}
 */
export function validateManifest(raw, file) {
  const c = new Collector(file);
  if (!c.table(raw, '')) return c.problems;
  const doc = /** @type {Record<string, unknown>} */ (raw);
  c.shape(doc, '', ['schema_version', 'component', 'imports', 'calls', 'entrypoints', 'runtime', 'protected'], [
    'schema_version',
    'component',
  ]);
  if ('schema_version' in doc && doc.schema_version !== 1) {
    c.add('schema_version', `unsupported schema_version ${JSON.stringify(doc.schema_version)} (supported: 1)`);
  }

  if ('component' in doc && c.table(doc.component, 'component')) {
    const comp = /** @type {Record<string, unknown>} */ (doc.component);
    c.shape(
      comp,
      'component',
      ['name', 'language', 'root', 'package', 'exclude', 'principle', 'decisions'],
      ['name', 'language', 'root', 'principle', 'decisions'],
    );
    if ('name' in comp) c.patterned(comp.name, 'component.name', PATTERNS.name, 'component name');
    if ('language' in comp && comp.language !== 'python' && comp.language !== 'node') {
      c.add('component.language', 'must be "python" or "node"');
    }
    if ('root' in comp) c.patterned(comp.root, 'component.root', PATTERNS.relPath, 'relative path');
    if ('package' in comp) c.patterned(comp.package, 'component.package', PATTERNS.dotted, 'dotted name');
    if (comp.language === 'python' && !('package' in comp)) {
      c.add('component.package', 'is required when language = "python"');
    }
    if ('exclude' in comp) {
      c.array(comp.exclude, 'component.exclude', {}, (g, k) => c.patterned(g, k, PATTERNS.relGlob, 'relative glob'));
    }
    if ('principle' in comp) {
      c.string(comp.principle, 'component.principle');
      if (typeof comp.principle === 'string' && codePoints(comp.principle) > 300) {
        c.add('component.principle', 'must be at most 300 characters');
      }
    }
    if ('decisions' in comp) {
      c.array(comp.decisions, 'component.decisions', { minItems: 1 }, (p, k) =>
        c.patterned(p, k, PATTERNS.relPath, 'relative path'),
      );
    }
  }

  if ('imports' in doc && c.table(doc.imports, 'imports')) {
    const imports = /** @type {Record<string, unknown>} */ (doc.imports);
    const kinds = ['internal', 'external', 'builtin'];
    c.shape(imports, 'imports', kinds, kinds);
    for (const kind of kinds) if (kind in imports) allowList(c, imports[kind], `imports.${kind}`);
  }

  if ('calls' in doc && c.table(doc.calls, 'calls')) {
    const calls = /** @type {Record<string, unknown>} */ (doc.calls);
    c.shape(calls, 'calls', ['forbidden'], ['forbidden']);
    if ('forbidden' in calls) {
      c.array(calls.forbidden, 'calls.forbidden', { minItems: 1 }, (item, key) => {
        if (typeof item === 'string') {
          c.patterned(item, key, PATTERNS.callPattern, 'call pattern');
        } else if (isTable(item)) {
          c.shape(item, key, ['pattern', 'reason'], ['pattern']);
          if ('pattern' in item) c.patterned(item.pattern, `${key}.pattern`, PATTERNS.callPattern, 'call pattern');
          if ('reason' in item) c.string(item.reason, `${key}.reason`);
        } else {
          c.add(key, 'must be a call pattern or a { pattern, reason } table');
        }
      });
    }
  }

  if ('entrypoints' in doc) {
    c.array(doc.entrypoints, 'entrypoints', { minItems: 1 }, (item, key) => {
      if (!c.table(item, key)) return;
      const group = /** @type {Record<string, unknown>} */ (item);
      c.shape(group, key, ['name', 'provider', 'exact'], ['name', 'provider', 'exact']);
      if ('name' in group) c.patterned(group.name, `${key}.name`, PATTERNS.entrypointName, 'entrypoint group name');
      if ('provider' in group) c.patterned(group.provider, `${key}.provider`, PATTERNS.ref, 'provider reference');
      if ('exact' in group) c.array(group.exact, `${key}.exact`, { unique: true }, (e, k) => c.string(e, k));
    });
  }

  if ('runtime' in doc && c.table(doc.runtime, 'runtime')) {
    const runtime = /** @type {Record<string, unknown>} */ (doc.runtime);
    c.shape(runtime, 'runtime', ['bind', 'secrets'], []);
    if (Object.keys(runtime).length === 0) c.add('runtime', 'must contain bind or secrets');
    if ('bind' in runtime && c.table(runtime.bind, 'runtime.bind')) {
      const bind = /** @type {Record<string, unknown>} */ (runtime.bind);
      c.shape(bind, 'runtime.bind', ['hosts', 'provider'], ['hosts', 'provider']);
      if ('hosts' in bind) c.array(bind.hosts, 'runtime.bind.hosts', { minItems: 1 }, (h, k) => c.string(h, k));
      if ('provider' in bind) c.patterned(bind.provider, 'runtime.bind.provider', PATTERNS.ref, 'provider reference');
    }
    if ('secrets' in runtime && c.table(runtime.secrets, 'runtime.secrets')) {
      const secrets = /** @type {Record<string, unknown>} */ (runtime.secrets);
      c.shape(secrets, 'runtime.secrets', ['names', 'probe'], ['names', 'probe']);
      if ('names' in secrets) {
        c.array(secrets.names, 'runtime.secrets.names', { minItems: 1, unique: true }, (n, k) =>
          c.patterned(n, k, PATTERNS.secretName, 'secret name'),
        );
      }
      if ('probe' in secrets) c.patterned(secrets.probe, 'runtime.secrets.probe', PATTERNS.ref, 'probe reference');
    }
  }

  if ('protected' in doc && c.table(doc.protected, 'protected')) {
    const prot = /** @type {Record<string, unknown>} */ (doc.protected);
    c.shape(prot, 'protected', ['paths'], ['paths']);
    if ('paths' in prot) {
      c.array(prot.paths, 'protected.paths', { minItems: 1 }, (g, k) => c.patterned(g, k, PATTERNS.relGlob, 'relative glob'));
    }
  }
  return c.problems;
}

/**
 * Validates a parsed `.boundaries/kit.toml` against the kit schema.
 * @param {unknown} raw
 * @param {string} file
 * @returns {Problem[]}
 */
export function validateKit(raw, file) {
  const c = new Collector(file);
  if (!c.table(raw, '')) return c.problems;
  const doc = /** @type {Record<string, unknown>} */ (raw);
  c.shape(doc, '', ['schema_version', 'decisions', 'rules_lint', 'protected', 'hook', 'python', 'node'], ['schema_version']);
  if ('schema_version' in doc && doc.schema_version !== 1) {
    c.add('schema_version', `unsupported schema_version ${JSON.stringify(doc.schema_version)} (supported: 1)`);
  }
  if ('decisions' in doc) {
    c.array(doc.decisions, 'decisions', {}, (p, k) => c.patterned(p, k, PATTERNS.relPath, 'relative path'));
  }
  if ('rules_lint' in doc && c.table(doc.rules_lint, 'rules_lint')) {
    const lint = /** @type {Record<string, unknown>} */ (doc.rules_lint);
    c.shape(lint, 'rules_lint', ['files', 'allow'], []);
    if ('files' in lint) {
      c.array(lint.files, 'rules_lint.files', {}, (g, k) => c.patterned(g, k, PATTERNS.relGlob, 'relative glob'));
    }
    if ('allow' in lint) c.array(lint.allow, 'rules_lint.allow', {}, (s, k) => c.string(s, k));
  }
  if ('protected' in doc && c.table(doc.protected, 'protected')) {
    const prot = /** @type {Record<string, unknown>} */ (doc.protected);
    c.shape(prot, 'protected', ['paths'], []);
    if ('paths' in prot) {
      c.array(prot.paths, 'protected.paths', {}, (g, k) => c.patterned(g, k, PATTERNS.relGlob, 'relative glob'));
    }
  }
  if ('hook' in doc && c.table(doc.hook, 'hook')) {
    const hook = /** @type {Record<string, unknown>} */ (doc.hook);
    c.shape(hook, 'hook', ['decision'], []);
    if ('decision' in hook && hook.decision !== 'ask' && hook.decision !== 'deny') {
      c.add('hook.decision', 'must be "ask" or "deny"');
    }
  }
  if ('python' in doc && c.table(doc.python, 'python')) {
    const py = /** @type {Record<string, unknown>} */ (doc.python);
    c.shape(py, 'python', ['sys_path'], []);
    if ('sys_path' in py) {
      c.array(py.sys_path, 'python.sys_path', {}, (p, k) => c.patterned(p, k, PATTERNS.relPath, 'relative path'));
    }
  }
  if ('node' in doc && c.table(doc.node, 'node')) {
    const node = /** @type {Record<string, unknown>} */ (doc.node);
    c.shape(node, 'node', ['tsconfig'], []);
    if ('tsconfig' in node) c.patterned(node.tsconfig, 'node.tsconfig', PATTERNS.relPath, 'relative path');
  }
  return c.problems;
}
