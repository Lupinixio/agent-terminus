// [runtime]: bind hosts and secret leaks. Runs project code.
import { format } from 'node:util';
import { plantEnv } from '../env.js';
import { ConfigError } from '../errors.js';
import { resolveRef } from '../refs.js';
import { findLeaks, makeSentinel } from '../sentinels.js';
import { callProvider } from './entrypoints.js';

/**
 * @typedef {import('../types.js').Project} Project
 * @typedef {import('../types.js').Manifest} Manifest
 * @typedef {import('../types.js').Violation} Violation
 */

/**
 * @param {Project} project
 * @param {Manifest} manifest
 * @returns {Promise<Violation[]>}
 */
export async function checkBind(project, manifest) {
  if (!manifest.bind) return [];
  const actual = await callProvider(project, manifest, manifest.bind.provider, 'runtime.bind.provider');
  const base = { component: manifest.component.name, check: /** @type {const} */ ('runtime.bind'), key: 'runtime.bind.hosts', location: null };
  if (actual.length === 0) return [{ ...base, message: `provider ${manifest.bind.provider} returned no host` }];
  const allowed = new Set(manifest.bind.hosts);
  return actual.filter((h) => !allowed.has(h)).map((h) => ({ ...base, message: `binds to ${h}, which is not in runtime.bind.hosts` }));
}

const CONSOLE_METHODS = /** @type {const} */ (['log', 'info', 'warn', 'error', 'debug', 'trace']);

/**
 * Runs `fn` with console and stdout/stderr captured; restores them afterwards.
 * @template T
 * @param {() => Promise<T>} fn
 * @returns {Promise<{ value: T, stdout: string, stderr: string }>}
 */
export async function captureOutput(fn) {
  let stdout = '';
  let stderr = '';
  const saved = {
    console: Object.fromEntries(CONSOLE_METHODS.map((m) => [m, console[m]])),
    out: process.stdout.write,
    err: process.stderr.write,
  };
  for (const m of CONSOLE_METHODS) {
    console[m] = (/** @type {unknown[]} */ ...args) => {
      const text = `${format(...args)}\n`;
      if (m === 'log' || m === 'info' || m === 'debug') stdout += text;
      else stderr += text;
    };
  }
  /** @param {'out' | 'err'} which */
  const writer = (which) =>
    /** @type {typeof process.stdout.write} */ (
      (/** @type {unknown} */ chunk) => {
        const text = typeof chunk === 'string' ? chunk : Buffer.from(/** @type {Uint8Array} */ (chunk)).toString('utf8');
        if (which === 'out') stdout += text;
        else stderr += text;
        return true;
      }
    );
  process.stdout.write = writer('out');
  process.stderr.write = writer('err');
  try {
    const value = await fn();
    return { value, stdout, stderr };
  } finally {
    process.stdout.write = saved.out;
    process.stderr.write = saved.err;
    for (const m of CONSOLE_METHODS) console[m] = /** @type {any} */ (saved.console[m]);
  }
}

/** @param {unknown} value @returns {string[]} */
function probeTexts(value) {
  if (value === undefined || value === null) return [];
  if (typeof value === 'string') return [value];
  if (typeof value === 'object' && Symbol.iterator in value) {
    return [...(/** @type {Iterable<unknown>} */ (value))].map((v) => (typeof v === 'string' ? v : format('%o', v)));
  }
  return [format('%o', value)];
}

/**
 * Plants a sentinel per secret name, runs the probe with output captured and
 * reports every place a sentinel shows up.
 * @param {Project} project
 * @param {Manifest} manifest
 * @returns {Promise<Violation[]>}
 */
export async function checkSecrets(project, manifest) {
  if (!manifest.secrets) return [];
  const { probe, names } = manifest.secrets;
  /** @type {(...args: unknown[]) => unknown} */
  let fn;
  try {
    fn = await resolveRef(project.root, probe);
  } catch (error) {
    throw new ConfigError(manifest.file, 'runtime.secrets.probe', error instanceof Error ? error.message : String(error));
  }
  /** @type {Record<string, string>} */
  const sentinels = Object.fromEntries(names.map((n) => [n, makeSentinel()]));
  const restore = plantEnv(sentinels);
  let captured;
  try {
    captured = await captureOutput(async () => fn());
  } catch (error) {
    throw new ConfigError(manifest.file, 'runtime.secrets.probe', `probe ${probe} failed: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    restore();
  }
  const texts = [
    ...probeTexts(captured.value).map((text) => ({ source: 'probe return value', text })),
    { source: 'stdout', text: captured.stdout },
    { source: 'stderr', text: captured.stderr },
  ];
  return findLeaks(texts, sentinels).map((leak) => ({
    component: manifest.component.name,
    check: /** @type {const} */ ('runtime.secrets'),
    key: 'runtime.secrets.names',
    location: null,
    message: `secret ${leak.name} leaked in ${leak.source} (${leak.form})`,
  }));
}
