import assert from 'node:assert/strict';
import { test } from 'node:test';
import { keyPaths, SUPPORTED_KEYS, unsupportedKeys } from '../src/support.js';
import { makeTmp, minimalProject, runCli } from './helpers/tmp.js';

const UI = `schema_version = 1

[component]
name = "ui"
language = "node"
root = "src/ui"
principle = "UI only."
decisions = ["docs/decisions/0001-boundaries.md"]
`;

test('keyPaths writes arrays of tables as key[].sub', () => {
  assert.deepEqual(
    keyPaths({
      imports: { internal: ['a', { target: 'b', only_from: ['c'] }], external: 'any', builtin: [] },
      entrypoints: [{ name: 'http', provider: 'p', exact: [] }],
    }),
    [
      'entrypoints[].exact',
      'entrypoints[].name',
      'entrypoints[].provider',
      'imports.builtin',
      'imports.external',
      'imports.internal',
      'imports.internal[].only_from',
      'imports.internal[].target',
    ],
  );
});

test('component.package is not supported by the node adapter', () => {
  assert.equal(SUPPORTED_KEYS.includes('component.package'), false);
  assert.deepEqual(unsupportedKeys({ component: { package: 'x' } }), ['component.package']);
});

test('unknown key runtime.network gives exit 3', (t) => {
  const dir = makeTmp(t, minimalProject({ '.boundaries/ui.toml': `${UI}\n[runtime.network]\nallow = []\n`, 'src/ui/a.js': '' }));
  const r = runCli(['validate', '--root', dir]);
  assert.equal(r.code, 3, r.stdout + r.stderr);
  assert.match(r.stdout, /runtime\.network/);
});

test('schema_version = 2 gives exit 3', (t) => {
  const dir = makeTmp(t, minimalProject({ '.boundaries/ui.toml': UI.replace('schema_version = 1', 'schema_version = 2'), 'src/ui/a.js': '' }));
  const r = runCli(['check', '--root', dir]);
  assert.equal(r.code, 3, r.stdout + r.stderr);
  assert.match(r.stdout, /schema_version/);
});
