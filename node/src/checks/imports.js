// [imports]: runs dependency-cruiser (peer dependency) in memory with the rules
// from depcruise-rules.js and maps its violations.
//
// dependency-cruiser resolves paths against the working directory, so the cruise
// runs with the project root as cwd (restored afterwards). Every source file of
// the component must show up in the cruise result; a file it could not analyse
// (for example TypeScript without a supported `typescript` package) is a config
// error, never a silent pass.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { ConfigError } from '../errors.js';
import { componentSources, parseSource } from './calls.js';
import { toDepcruiseRules } from './depcruise-rules.js';

/**
 * @typedef {import('../types.js').Project} Project
 * @typedef {import('../types.js').Manifest} Manifest
 * @typedef {import('../types.js').Violation} Violation
 * @typedef {{ from: string, to: string, unresolvedTo?: string, rule: { name: string } }} CruiseViolation
 * @typedef {{ modules: { source: string }[], summary: { violations: CruiseViolation[] } }} CruiseResult
 */

/** @returns {Promise<any>} */
async function loadDepcruise() {
  return import('dependency-cruiser');
}

/**
 * First line of a file that mentions the import specifier, as `file:line`.
 * @param {string} root
 * @param {string} file
 * @param {string} specifier
 */
function locate(root, file, specifier) {
  try {
    const lines = readFileSync(path.join(root, file), 'utf8').split('\n');
    const quoted = [specifier, `node:${specifier}`].flatMap((s) => [`'${s}'`, `"${s}"`, `\`${s}\``]);
    const index = lines.findIndex((l) => quoted.some((q) => l.includes(q)));
    return index === -1 ? file : `${file}:${index + 1}`;
  } catch {
    return file;
  }
}

/** @param {string} ruleName */
function ruleKey(ruleName) {
  const kind = ruleName.split('/').pop() ?? '';
  const match = /^(internal|external|builtin)/.exec(kind);
  return match ? `imports.${match[1]}` : 'imports';
}

/**
 * @param {Project} project
 * @param {Manifest} manifest
 * @returns {Promise<Violation[]>}
 */
export async function checkImports(project, manifest) {
  if (!manifest.imports) return [];
  let depcruise;
  try {
    depcruise = await loadDepcruise();
  } catch {
    throw new ConfigError(
      manifest.file,
      'imports',
      'dependency-cruiser ^18 is needed to check [imports] of Node components; install it as a dev dependency',
    );
  }
  // dependency-cruiser skips files it cannot parse without a word; parse them first.
  for (const file of componentSources(project, manifest)) {
    try {
      parseSource(readFileSync(path.join(project.root, file), 'utf8'), file);
    } catch (error) {
      throw new ConfigError(file, 'imports', `cannot parse ${file}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  const rules = toDepcruiseRules(manifest);
  /** @type {Record<string, unknown>} */
  const options = { validate: true, ruleSet: { forbidden: rules }, doNotFollow: { path: 'node_modules' } };
  /** @type {Record<string, unknown> | undefined} */
  let transpileOptions;
  const tsconfig = project.kit.nodeTsconfig;
  const previous = process.cwd();
  /** @type {CruiseResult} */
  let result;
  try {
    process.chdir(project.root);
    if (tsconfig) {
      const { default: extractTSConfig } = await import('dependency-cruiser/config-utl/extract-ts-config');
      options.tsConfig = { fileName: tsconfig };
      transpileOptions = { tsConfig: extractTSConfig(tsconfig) };
    }
    const reported = await depcruise.cruise([manifest.component.root], options, undefined, transpileOptions);
    result = reported.output;
  } catch (error) {
    throw new ConfigError(manifest.file, 'imports', `dependency-cruiser failed: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    process.chdir(previous);
  }
  const seen = new Set(result.modules.map((m) => m.source));
  const unseen = componentSources(project, manifest).filter((f) => !seen.has(f));
  if (unseen.length > 0) {
    throw new ConfigError(
      manifest.file,
      'imports',
      `dependency-cruiser did not analyse ${unseen.join(', ')}; for TypeScript it needs a supported typescript package (dependency-cruiser 18 supports typescript >=2 <7)`,
    );
  }
  return result.summary.violations.map((v) => {
    const specifier = v.unresolvedTo ?? v.to;
    const key = ruleKey(v.rule.name);
    const shown = `${specifier}${v.to !== specifier ? ` (${v.to})` : ''}`;
    const rule = rules.find((r) => r.name === v.rule.name);
    let message = `import ${shown} is not allowed by ${key}`;
    if (key === 'imports') message = `import ${specifier} cannot be resolved, so its limits cannot be checked`;
    else if (v.rule.name.includes('-only-from-') && rule) message = `import ${shown}: ${rule.comment.slice(rule.comment.indexOf(': ') + 2)}`;
    return {
      component: manifest.component.name,
      check: /** @type {const} */ ('imports'),
      key,
      location: locate(project.root, v.from, specifier),
      message,
    };
  });
}
