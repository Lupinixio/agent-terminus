import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { copyFixture, runCli, writeFiles } from './helpers/tmp.js';

/** @param {string} dir @param {string[]} args */
function git(dir, args) {
  const r = spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout;
}

/** @param {{ after: (fn: () => void) => void }} t */
function repo(t) {
  const dir = copyFixture(t, 'fixtures/node/passing');
  git(dir, ['init', '-q', '-b', 'main']);
  git(dir, ['-c', 'user.name=test', '-c', 'user.email=test@example.invalid', 'add', '-A']);
  git(dir, ['-c', 'user.name=test', '-c', 'user.email=test@example.invalid', 'commit', '-q', '-m', 'base']);
  return dir;
}

/** @param {string} dir */
function loosen(dir) {
  const file = path.join(dir, '.boundaries/dashboard.toml');
  writeFileSync(file, readFileSync(file, 'utf8').replace('builtin = []', 'builtin = ["path"]'));
}

test('no change passes; bad ref is a usage error', (t) => {
  const dir = repo(t);
  assert.equal(runCli(['diff', '--root', dir, '--base', 'main']).code, 0);
  assert.equal(runCli(['diff', '--root', dir, '--base', 'no-such-ref']).code, 2);
  assert.equal(runCli(['diff', '--root', dir]).code, 2);
});

test('a manifest change without a new decision fails', (t) => {
  const dir = repo(t);
  loosen(dir);
  const r = runCli(['diff', '--root', dir, '--base', 'main']);
  assert.equal(r.code, 1, r.stdout);
  assert.match(r.stdout, /dashboard\.toml/);
});

test('generated-only changes pass', (t) => {
  const dir = repo(t);
  writeFiles(dir, { '.boundaries/generated/index.json': '{}\n' });
  assert.equal(runCli(['diff', '--root', dir, '--base', 'main']).code, 0);
});

test('a new, existing decision record passes; an old or missing one does not', (t) => {
  const dir = repo(t);
  loosen(dir);
  const file = path.join(dir, '.boundaries/dashboard.toml');
  const withDecision = (/** @type {string} */ d) =>
    writeFileSync(
      file,
      readFileSync(file, 'utf8').replace(/decisions = \[.*\]/, `decisions = ["docs/decisions/0001-dashboard-boundary.md", "${d}"]`),
    );
  withDecision('docs/decisions/0002-allow-path.md');
  assert.equal(runCli(['diff', '--root', dir, '--base', 'main']).code, 1, 'record must exist');
  writeFiles(dir, { 'docs/decisions/0002-allow-path.md': '# 0002\n' });
  assert.equal(runCli(['diff', '--root', dir, '--base', 'main']).code, 0);
});

test('an untracked new manifest counts as a change', (t) => {
  const dir = repo(t);
  writeFiles(dir, { '.boundaries/other.toml': 'schema_version = 1\n' });
  assert.equal(runCli(['diff', '--root', dir, '--base', 'main']).code, 1);
});
