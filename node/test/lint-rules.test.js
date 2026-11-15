import assert from 'node:assert/strict';
import { test } from 'node:test';
import { lintRules, lintText, ownedIdentifiers } from '../src/lint-rules.js';
import { loadProject } from '../src/manifest.js';
import { copyFixture, runCli, writeFiles } from './helpers/tmp.js';

/** @type {import('../src/lint-rules.js').Owned[]} */
const OWNED = [
  { id: 'API_TOKEN', file: '.boundaries/web.toml', key: 'runtime.secrets.names' },
  { id: 'POST /api/pause', file: '.boundaries/web.toml', key: 'entrypoints[0].exact' },
  { id: '/api/pause', file: '.boundaries/web.toml', key: 'entrypoints[0].exact' },
  { id: 'os.system', file: '.boundaries/web.toml', key: 'calls.forbidden' },
];

test('a restated secret name and route are caught', () => {
  const text = 'Never log API_TOKEN.\nThe dashboard exposes POST /api/pause.\n';
  const found = lintText(text, 'CLAUDE.md', OWNED, []);
  assert.deepEqual(
    found.map((f) => `${f.line}:${f.col} ${f.id}`),
    ['1:11 API_TOKEN', '2:23 POST /api/pause', '2:28 /api/pause'],
  );
});

test('word boundaries and dotted names', () => {
  assert.deepEqual(lintText('MY_API_TOKEN API_TOKENS', 'a.md', OWNED, []), []);
  assert.deepEqual(lintText('call os.system.x or xos.system', 'a.md', OWNED, []), []);
  assert.equal(lintText('no os.system here', 'a.md', OWNED, []).length, 1);
});

test('the manifest pointer and the allow list pass', () => {
  assert.deepEqual(lintText('See .boundaries/web.toml#API_TOKEN for limits.', 'a.md', OWNED, []), []);
  assert.deepEqual(lintText('Never log API_TOKEN.', 'a.md', OWNED, ['API_TOKEN']), []);
});

test('owned identifiers from the fixture manifest', async () => {
  const project = await loadProject(`${process.cwd()}/fixtures/node/passing`);
  const ids = ownedIdentifiers(project).map((o) => o.id);
  for (const id of ['GET /api/status', '/api/status', 'POST /api/pause', '127.0.0.1', 'src/clock.js', 'src/dashboard/settings.js', 'src/dashboard/boundary.ts']) {
    assert.ok(ids.includes(id), id);
  }
  assert.ok(!ids.includes('/'), 'the root path alone is not owned');
  assert.ok(!ids.includes('smol-toml'), 'externals are not owned');
});

test('CLI: rules files are scanned; kit.toml allow and --files work', async (t) => {
  const dir = copyFixture(t, 'fixtures/node/passing');
  writeFiles(dir, {
    'CLAUDE.md': '# Rules\n\nThe dashboard binds 127.0.0.1 only. Limits: .boundaries/dashboard.toml\n',
    '.claude/agents/dev.md': 'Do not add routes beyond GET /api/status.\n',
    'docs/notes.md': 'GET /api/status is not a rules file.\n',
    'node_modules/x/CLAUDE.md': '127.0.0.1\n',
  });
  const r = runCli(['lint-rules', '--root', dir]);
  assert.equal(r.code, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /CLAUDE\.md:3:21 127\.0\.0\.1 \(owned by \.boundaries\/dashboard\.toml runtime\.bind\.hosts\)/);
  assert.match(r.stdout, /\.claude\/agents\/dev\.md:1:26 GET \/api\/status/);
  assert.doesNotMatch(r.stdout, /notes\.md|node_modules/);
  assert.equal(runCli(['lint-rules', '--root', dir, '--files', 'README.md']).code, 0);
  writeFiles(dir, {
    '.boundaries/kit.toml': 'schema_version = 1\ndecisions = ["docs/decisions/0001-dashboard-boundary.md"]\n[rules_lint]\nallow = ["127.0.0.1", "GET /api/status", "/api/status"]\n',
  });
  const project = await loadProject(dir);
  assert.deepEqual(lintRules(project), []);
});
