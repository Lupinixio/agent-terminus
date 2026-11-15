import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkEntrypoints, compareEntrypoints } from '../src/checks/entrypoints.js';
import { loadProject } from '../src/manifest.js';
import { assertEntrypoints } from '../src/testing.js';
import { copyFixture, REPO, writeFiles } from './helpers/tmp.js';

test('compare normalizes whitespace and reports both directions', () => {
  assert.deepEqual(compareEntrypoints(['GET  /', 'POST /a'], [' GET /', 'POST /b']), { missing: ['POST /a'], extra: ['POST /b'] });
});

test('violating fixture: extra route', async () => {
  const project = await loadProject(`${REPO}/fixtures/node/violating`);
  const found = await checkEntrypoints(project, project.manifests[0]);
  assert.deepEqual(
    found.map((v) => [v.key, v.message]),
    [['entrypoints[0].exact', 'http: "POST /api/flatten" is exposed but not declared']],
  );
});

test('missing route is reported', async (t) => {
  const dir = copyFixture(t, 'fixtures/node/passing');
  writeFiles(dir, {
    'src/dashboard/boundary.ts': "export function httpRoutes(): string[] { return ['GET /']; }\nexport function bindHosts() { return ['127.0.0.1']; }\n",
  });
  const project = await loadProject(dir);
  const found = await checkEntrypoints(project, project.manifests[0]);
  assert.deepEqual(
    found.map((v) => v.message),
    ['http: "GET /api/status" is declared but not exposed', 'http: "POST /api/pause" is declared but not exposed'],
  );
});

test('a provider that is missing or returns a non-iterable is a config error', async (t) => {
  const dir = copyFixture(t, 'fixtures/node/passing');
  writeFiles(dir, { 'src/dashboard/boundary.ts': 'export function httpRoutes() { return 3; }\n' });
  const project = await loadProject(dir);
  await assert.rejects(checkEntrypoints(project, project.manifests[0]), /iterable of strings/);
  writeFiles(dir, { 'src/dashboard/boundary.ts': 'export const nothing = 1;\n' });
  const fresh = await loadProject(dir);
  fresh.manifests[0].entrypoints[0].provider = './src/dashboard/boundary.ts#absent';
  await assert.rejects(checkEntrypoints(fresh, fresh.manifests[0]), /no exported function absent/);
});

test('assertEntrypoints lists every difference', async () => {
  const project = await loadProject(`${REPO}/fixtures/node/passing`);
  await assertEntrypoints(project.manifests[0], ['GET /', 'GET /api/status', 'POST /api/pause']);
  await assert.rejects(assertEntrypoints(project.manifests[0], ['GET /', 'GET /x']), (/** @type {Error} */ e) => {
    assert.equal(e.name, 'AssertionError');
    assert.match(e.message, /exposed but not declared: GET \/x/);
    assert.match(e.message, /declared but not exposed: POST \/api\/pause/);
    return true;
  });
});
