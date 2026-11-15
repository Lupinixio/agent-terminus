import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { parse } from 'yaml';
import { HOOK_COMMAND, preCommitFor, workflowFor } from '../src/init.js';
import { makeTmp, REPO, runCli, writeFiles } from './helpers/tmp.js';

/** @param {string} dir @param {string} rel */
const read = (dir, rel) => readFileSync(path.join(dir, rel), 'utf8');

test('init creates the basics, is idempotent, and check passes afterwards', (t) => {
  const dir = makeTmp(t, { 'package.json': '{"type":"module"}' });
  const first = runCli(['init', '--root', dir]);
  assert.equal(first.code, 0, first.stderr);
  for (const rel of ['.boundaries/kit.toml', '.boundaries/rules.md', '.boundaries/component.toml.example', '.boundaries/generated/index.json']) {
    assert.ok(existsSync(path.join(dir, rel)), rel);
  }
  assert.match(read(dir, '.boundaries/rules.md'), /^<!-- agent-terminus \d+\.\d+\.\d+/);
  assert.match(first.stdout, /# BEGIN agent-terminus/);
  assert.match(first.stdout, /boundaries \/ node/);
  const second = runCli(['init', '--root', dir]);
  assert.doesNotMatch(second.stdout, /created|updated/);
  assert.equal(runCli(['check', '--root', dir]).code, 0);
});

test('refuses to overwrite a changed file without --update', (t) => {
  const dir = makeTmp(t);
  runCli(['init', '--root', dir]);
  writeFiles(dir, { '.boundaries/rules.md': 'local edits\n' });
  const r = runCli(['init', '--root', dir]);
  assert.match(r.stdout, /kept \.boundaries\/rules\.md/);
  assert.equal(read(dir, '.boundaries/rules.md'), 'local edits\n');
  runCli(['init', '--root', dir, '--update']);
  assert.notEqual(read(dir, '.boundaries/rules.md'), 'local edits\n');
});

test('--claude merges settings and keeps foreign hooks', (t) => {
  const dir = makeTmp(t, {
    '.claude/settings.json': JSON.stringify({
      permissions: { allow: ['Bash(npm test)'] },
      hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'node other.mjs' }] }] },
    }),
    'CLAUDE.md': '# Project\n',
  });
  runCli(['init', '--root', dir, '--claude']);
  runCli(['init', '--root', dir, '--claude']);
  const settings = JSON.parse(read(dir, '.claude/settings.json'));
  assert.deepEqual(settings.permissions, { allow: ['Bash(npm test)'] });
  assert.equal(settings.hooks.PreToolUse.length, 2);
  assert.equal(settings.hooks.PreToolUse[1].hooks[0].command, HOOK_COMMAND);
  assert.equal(read(dir, '.claude/hooks/protect-boundaries.mjs'), read(REPO, 'hooks/protect-boundaries.mjs'));
  const claude = read(dir, 'CLAUDE.md');
  assert.equal(claude.match(/@\.boundaries\/rules\.md/g)?.length, 1);
});

test('--claude prints the entry when settings.json is not JSON', (t) => {
  const dir = makeTmp(t, { '.claude/settings.json': '{ broken' });
  const r = runCli(['init', '--root', dir, '--claude']);
  assert.match(r.stdout, /not valid JSON/);
  assert.equal(read(dir, '.claude/settings.json'), '{ broken');
});

test('--agents-md inlines the rules between markers once', (t) => {
  const dir = makeTmp(t, { 'AGENTS.md': '# Agents\n' });
  runCli(['init', '--root', dir, '--agents-md']);
  runCli(['init', '--root', dir, '--agents-md']);
  const text = read(dir, 'AGENTS.md');
  assert.equal(text.match(/agent-terminus:rules:start/g)?.length, 1);
  assert.match(text, /^# Agents/);
  assert.match(text, /Read a component's manifest/);
});

test('--git-hook writes commands for the detected languages and prints git config', (t) => {
  const dir = makeTmp(t, { 'pyproject.toml': '[project]\nname = "x"\n', 'uv.lock': '' });
  const r = runCli(['init', '--root', dir, '--git-hook']);
  assert.match(r.stdout, /git config core\.hooksPath \.githooks/);
  const hook = read(dir, '.githooks/pre-commit');
  assert.match(hook, /^uv run boundaries check$/m);
  assert.match(hook, /^# npx --yes --package=github:Lupinixio\/agent-terminus#v/m);
  assert.match(preCommitFor({ python: true, node: false, uvLock: false }), /^python -m agent_terminus check$/m);
  assert.match(preCommitFor({ python: false, node: true, uvLock: false }), /^npx --no-install boundaries lint-rules$/m);
});

test('--with-ci writes the workflow and the CODEOWNERS block, warning about the placeholder', (t) => {
  const dir = makeTmp(t, { 'package.json': '{}' });
  const r = runCli(['init', '--root', dir, '--with-ci']);
  assert.match(r.stdout, /WARNING: CODEOWNERS uses the placeholder owner @your-org\/boundary-owners/);
  const workflow = parse(read(dir, '.github/workflows/boundaries.yml'));
  assert.deepEqual(Object.keys(workflow.jobs), ['node']);
  assert.match(read(dir, '.github/CODEOWNERS'), /\/\.boundaries\/ @your-org\/boundary-owners/);
  assert.equal(runCli(['check', '--root', dir]).code, 0);
  const owned = makeTmp(t, { 'pyproject.toml': '' });
  runCli(['init', '--root', owned, '--with-ci', '--owner', '@acme/owners']);
  assert.match(read(owned, '.github/CODEOWNERS'), /@acme\/owners/);
  assert.deepEqual(Object.keys(parse(read(owned, '.github/workflows/boundaries.yml')).jobs), ['python']);
});

test('workflowFor keeps both jobs for mixed projects', () => {
  assert.deepEqual(Object.keys(parse(workflowFor({ python: true, node: true })).jobs), ['python', 'node']);
});

test('--dry-run writes nothing', (t) => {
  const dir = makeTmp(t);
  const r = runCli(['init', '--root', dir, '--dry-run', '--claude', '--with-ci']);
  assert.equal(r.code, 0);
  assert.match(r.stdout, /would write \.boundaries\/kit\.toml/);
  assert.equal(existsSync(path.join(dir, '.boundaries')), false);
});
