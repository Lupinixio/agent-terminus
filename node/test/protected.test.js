import assert from 'node:assert/strict';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { checkProtected } from '../src/checks/protected.js';
import { loadProject } from '../src/manifest.js';
import { copyFixture, runCli } from './helpers/tmp.js';

test('provider not covered by protected.paths is a violation (exit 1)', async (t) => {
  const dir = copyFixture(t, 'fixtures/node/passing');
  const file = path.join(dir, '.boundaries/dashboard.toml');
  writeFileSync(file, readFileSync(file, 'utf8').replace('paths = ["src/dashboard/boundary.ts"]', 'paths = ["src/dashboard/app.js"]'));
  const project = await loadProject(dir);
  const found = await checkProtected(project, project.manifests[0]);
  assert.deepEqual(
    found.map((v) => [v.key, v.message]),
    [['protected.paths', 'src/dashboard/boundary.ts (from entrypoints[0].provider) is not covered by protected.paths']],
  );
  runCli(['generate', '--root', dir]);
  assert.equal(runCli(['check', '--root', dir]).code, 1);
});

test('missing protected path is a config error (exit 3)', (t) => {
  const dir = copyFixture(t, 'fixtures/node/passing');
  rmSync(path.join(dir, 'src/dashboard/boundary.ts'));
  const r = runCli(['check', '--root', dir, '--format', 'json']);
  assert.equal(r.code, 3);
  assert.ok(JSON.parse(r.stdout).errors.some((/** @type {{ key: string }} */ e) => e.key === 'protected.paths[0]'));
});
