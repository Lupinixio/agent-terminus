// Test helpers: temp projects under <repo>/.scratch and CLI runners.
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
export const BIN = path.join(REPO, 'node/bin/boundaries.mjs');
export const HOOK = path.join(REPO, 'hooks/protect-boundaries.mjs');

/**
 * Creates an empty temp directory under .scratch, removed after the test.
 * @param {{ after: (fn: () => void) => void }} t
 * @param {Record<string, string>} [files] project-relative path -> content
 */
export function makeTmp(t, files = {}) {
  const base = path.join(REPO, '.scratch', 'node-test');
  mkdirSync(base, { recursive: true });
  const dir = mkdtempSync(path.join(base, 't-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFiles(dir, files);
  return dir;
}

/**
 * @param {string} dir
 * @param {Record<string, string>} files
 */
export function writeFiles(dir, files) {
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }
}

/**
 * Copies a fixture (relative to the repo) into a temp dir.
 * @param {{ after: (fn: () => void) => void }} t
 * @param {string} fixture
 */
export function copyFixture(t, fixture) {
  const dir = makeTmp(t);
  cpSync(path.join(REPO, fixture), dir, { recursive: true });
  return dir;
}

/**
 * Runs the CLI in a child process.
 * @param {string[]} args
 * @param {{ cwd?: string, input?: string }} [options]
 */
export function runCli(args, options = {}) {
  const r = spawnSync(process.execPath, [BIN, ...args], { cwd: options.cwd ?? REPO, encoding: 'utf8', input: options.input });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
}

/**
 * A minimal valid project: kit.toml, one decision, generated index.
 * @param {Record<string, string>} [extra]
 */
export function minimalProject(extra = {}) {
  return {
    '.boundaries/kit.toml': 'schema_version = 1\ndecisions = ["docs/decisions/0001-boundaries.md"]\n',
    'docs/decisions/0001-boundaries.md': '# 0001 Boundaries\n',
    ...extra,
  };
}
