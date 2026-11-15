import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkImports } from '../src/checks/imports.js';
import { loadProject } from '../src/manifest.js';
import { copyFixture, makeTmp, minimalProject, REPO, writeFiles } from './helpers/tmp.js';

/** @param {string} root */
async function importsOf(root) {
  const project = await loadProject(root);
  assert.deepEqual(project.problems, []);
  const manifest = project.manifests.find((m) => m.component.name === 'dashboard');
  assert.ok(manifest);
  return checkImports(project, manifest);
}

test('passing fixture: real cruise finds nothing (including the .ts provider)', async () => {
  assert.deepEqual(await importsOf(`${REPO}/fixtures/node/passing`), []);
});

test('golden: violating fixture (core modules are reported without the node: prefix)', async () => {
  const found = (await importsOf(`${REPO}/fixtures/node/violating`)).map((v) => [v.key, v.location, v.message.split(' ').slice(0, 2).join(' ')]);
  assert.deepEqual(found, [
    ['imports.builtin', 'src/dashboard/app.js:3', 'import child_process'],
    ['imports.builtin', 'src/dashboard/app.js:2', 'import fs'],
    ['imports.external', 'src/dashboard/app.js:4', 'import ajv'],
    ['imports.external', 'src/dashboard/app.js:5', 'import smol-toml'],
    ['imports.internal', 'src/dashboard/app.js:8', 'import ../core/engine.js'],
  ]);
});

test('unresolvable import is a violation', async (t) => {
  const dir = copyFixture(t, 'fixtures/node/passing');
  writeFiles(dir, { 'src/dashboard/extra.js': "import x from './missing.js';\nexport default x;\n" });
  const found = await importsOf(dir);
  assert.equal(found.length, 1);
  assert.equal(found[0].key, 'imports');
  assert.match(found[0].message, /cannot be resolved/);
});

test('a file dependency-cruiser cannot analyse is a config error', async (t) => {
  const dir = makeTmp(
    t,
    minimalProject({
      '.boundaries/ui.toml': `schema_version = 1
[component]
name = "ui"
language = "node"
root = "src/ui"
principle = "UI."
decisions = ["docs/decisions/0001-boundaries.md"]
[imports]
internal = []
external = []
builtin = []
`,
      'package.json': '{"type":"module"}',
      'src/ui/a.js': 'export const a = (;\n',
    }),
  );
  const project = await loadProject(dir);
  await assert.rejects(checkImports(project, project.manifests[0]), (/** @type {any} */ e) => e.name === 'ConfigError');
});
