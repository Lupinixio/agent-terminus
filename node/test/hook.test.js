import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { decide, isReadOnlySegment } from '../../hooks/protect-boundaries.mjs';
import { HOOK, makeTmp, writeFiles } from './helpers/tmp.js';

/**
 * Spawns the hook with a PreToolUse event on stdin.
 * @param {Record<string, unknown>} event
 */
function runHook(event) {
  const r = spawnSync(process.execPath, [HOOK], { input: JSON.stringify(event), encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim() ? JSON.parse(r.stdout).hookSpecificOutput : null;
}

/** @param {{ after: (fn: () => void) => void }} t */
function project(t) {
  return makeTmp(t, {
    '.boundaries/web.toml': 'x',
    '.boundaries/generated/index.json': JSON.stringify({
      schema_version: 1,
      decision: 'ask',
      protected: ['.boundaries/**', 'src/web/boundary.py', 'tests/boundaries/**'],
    }),
    'src/web/boundary.py': '',
    'src/web/app.py': '',
  });
}

test('edit of a manifest asks', (t) => {
  const dir = project(t);
  const out = runHook({ tool_name: 'Edit', tool_input: { file_path: path.join(dir, '.boundaries/x.toml') }, cwd: dir });
  assert.equal(out.hookEventName, 'PreToolUse');
  assert.equal(out.permissionDecision, 'ask');
  assert.match(out.permissionDecisionReason, /\.boundaries\/x\.toml/);
});

test('manifest-protected path asks; unrelated file is silent', (t) => {
  const dir = project(t);
  assert.equal(runHook({ tool_name: 'Write', tool_input: { file_path: path.join(dir, 'src/web/boundary.py') }, cwd: dir }).permissionDecision, 'ask');
  assert.equal(runHook({ tool_name: 'Write', tool_input: { file_path: path.join(dir, 'tests/boundaries/new_test.py') }, cwd: dir }).permissionDecision, 'ask');
  assert.equal(runHook({ tool_name: 'Edit', tool_input: { file_path: path.join(dir, 'src/web/app.py') }, cwd: dir }), null);
});

test('no .boundaries means no output', (t) => {
  // makeTmp() lives inside the kit repo, whose own .boundaries/ would be found; use the OS temp dir instead.
  const dir = mkdtempSync(path.join(os.tmpdir(), 'agent-terminus-hook-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(path.join(dir, 'a.txt'), '');
  assert.equal(decide({ toolName: 'Edit', toolInput: { file_path: path.join(dir, 'a.txt') }, cwd: dir }), null);
});

test('bash write asks, bash read is silent', (t) => {
  const dir = project(t);
  assert.equal(runHook({ tool_name: 'Bash', tool_input: { command: 'echo x > .boundaries/a.toml' }, cwd: dir }).permissionDecision, 'ask');
  assert.equal(runHook({ tool_name: 'Bash', tool_input: { command: 'cat .boundaries/a.toml' }, cwd: dir }), null);
  assert.equal(runHook({ tool_name: 'Bash', tool_input: { command: 'cat .boundaries/a.toml 2>/dev/null | grep x' }, cwd: dir }), null);
  assert.equal(runHook({ tool_name: 'Bash', tool_input: { command: 'sed -i s/a/b/ src/web/boundary.py' }, cwd: dir }).permissionDecision, 'ask');
  assert.equal(runHook({ tool_name: 'Bash', tool_input: { command: 'npm test' }, cwd: dir }), null);
  assert.equal(runHook({ tool_name: 'PowerShell', tool_input: { command: 'Get-Content .boundaries\\web.toml' }, cwd: dir }), null);
  assert.equal(
    runHook({ tool_name: 'PowerShell', tool_input: { command: 'Set-Content .boundaries\\web.toml x' }, cwd: dir }).permissionDecision,
    'ask',
  );
});

test('read-only segments', () => {
  assert.equal(isReadOnlySegment('git diff .boundaries'), true);
  assert.equal(isReadOnlySegment('git checkout .boundaries'), false);
  assert.equal(isReadOnlySegment('npx --no-install boundaries check'), true);
  assert.equal(isReadOnlySegment('uv run boundaries validate'), true);
  assert.equal(isReadOnlySegment('cat a > b'), false);
  assert.equal(isReadOnlySegment('Get-Content x 2>$null'), true);
});

test('backslash Windows path asks', (t) => {
  const dir = project(t);
  const target = `${dir}\\.boundaries\\web.toml`.replace(/\//g, '\\');
  const expected = process.platform === 'win32' ? 'ask' : null;
  const out = runHook({ tool_name: 'Edit', tool_input: { file_path: target }, cwd: dir });
  assert.equal(out?.permissionDecision ?? null, expected);
});

test('relative path resolves from cwd', (t) => {
  const dir = project(t);
  assert.equal(runHook({ tool_name: 'Edit', tool_input: { file_path: '.boundaries/web.toml' }, cwd: dir }).permissionDecision, 'ask');
});

test('hook.decision = "deny" denies', (t) => {
  const dir = project(t);
  writeFiles(dir, { '.boundaries/generated/index.json': JSON.stringify({ schema_version: 1, decision: 'deny', protected: [] }) });
  assert.equal(runHook({ tool_name: 'Edit', tool_input: { file_path: path.join(dir, '.boundaries/web.toml') }, cwd: dir }).permissionDecision, 'deny');
});

test('corrupt index fails closed', (t) => {
  const dir = project(t);
  writeFiles(dir, { '.boundaries/generated/index.json': '{ not json' });
  assert.equal(runHook({ tool_name: 'Edit', tool_input: { file_path: path.join(dir, 'src/web/app.py') }, cwd: dir }).permissionDecision, 'ask');
});

test('the hook itself and settings.json are protected', (t) => {
  const dir = project(t);
  for (const rel of ['.claude/hooks/protect-boundaries.mjs', '.claude/settings.json', '.claude/settings.local.json', '.github/CODEOWNERS']) {
    assert.equal(runHook({ tool_name: 'Write', tool_input: { file_path: path.join(dir, rel) }, cwd: dir }).permissionDecision, 'ask', rel);
  }
});

test('NotebookEdit uses notebook_path; other tools are ignored', (t) => {
  const dir = project(t);
  assert.equal(
    runHook({ tool_name: 'NotebookEdit', tool_input: { notebook_path: path.join(dir, '.boundaries/n.ipynb') }, cwd: dir }).permissionDecision,
    'ask',
  );
  assert.equal(runHook({ tool_name: 'Read', tool_input: { file_path: path.join(dir, '.boundaries/web.toml') }, cwd: dir }), null);
});

test('garbage on stdin fails closed', () => {
  const r = spawnSync(process.execPath, [HOOK], { input: 'nope', encoding: 'utf8' });
  assert.equal(JSON.parse(r.stdout).hookSpecificOutput.permissionDecision, 'ask');
});
