import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { generate } from '../src/generate.js';
import { buildIndex, canonicalJson } from '../src/index-file.js';
import { loadProject } from '../src/manifest.js';
import { BUILTIN_PROTECTED } from '../src/support.js';
import { makeTmp, minimalProject, runCli } from './helpers/tmp.js';

const PY = `schema_version = 1

[component]
name = "web"
language = "python"
root = "src/app/web"
package = "app.web"
principle = "Web only."
decisions = ["docs/decisions/0001-boundaries.md"]

[protected]
paths = ["src/app/web/boundary.py", "tests/**"]
`;

test('canonicalJson sorts keys, 2-space indent, trailing newline', () => {
  assert.equal(canonicalJson({ b: 1, a: [{ d: 1, c: 2 }] }), '{\n  "a": [\n    {\n      "c": 2,\n      "d": 1\n    }\n  ],\n  "b": 1\n}\n');
});

test('index covers built-ins, kit and every manifest (any language)', async (t) => {
  const dir = makeTmp(
    t,
    minimalProject({
      '.boundaries/kit.toml': 'schema_version = 1\n[protected]\npaths = ["CLAUDE.md"]\n[hook]\ndecision = "deny"\n',
      'CLAUDE.md': '',
      '.boundaries/web.toml': PY,
      'src/app/web/boundary.py': '',
      'tests/test_x.py': '',
    }),
  );
  const index = JSON.parse(buildIndex(await loadProject(dir)));
  assert.equal(index.decision, 'deny');
  assert.equal(index.schema_version, 1);
  assert.deepEqual(index.protected, [...new Set([...BUILTIN_PROTECTED, 'CLAUDE.md', 'src/app/web/boundary.py', 'tests/**'])].sort());
});

test('generate writes index.json; no depcruise.cjs without node imports', async (t) => {
  const dir = makeTmp(t, minimalProject());
  const first = await generate({ root: dir, write: true });
  assert.deepEqual(first, [
    { file: '.boundaries/generated/index.json', stale: true },
    { file: '.boundaries/generated/depcruise.cjs', stale: false },
  ]);
  const second = await generate({ root: dir, write: false });
  assert.ok(second.every((f) => !f.stale));
});

test('stale index gives exit 4; fresh gives 0', (t) => {
  const dir = makeTmp(t, minimalProject());
  assert.equal(runCli(['check', '--root', dir]).code, 4);
  assert.equal(runCli(['generate', '--root', dir]).code, 0);
  assert.equal(runCli(['check', '--root', dir]).code, 0);
  const file = path.join(dir, '.boundaries/generated/index.json');
  writeFileSync(file, readFileSync(file, 'utf8').replace('"ask"', '"deny"'));
  const r = runCli(['check', '--root', dir, '--format', 'json']);
  assert.equal(r.code, 4);
  assert.deepEqual(JSON.parse(r.stdout).stale, ['.boundaries/generated/index.json']);
});

test('CRLF line endings do not count as stale', (t) => {
  const dir = makeTmp(t, minimalProject());
  runCli(['generate', '--root', dir]);
  const file = path.join(dir, '.boundaries/generated/index.json');
  writeFileSync(file, readFileSync(file, 'utf8').replace(/\n/g, '\r\n'));
  assert.equal(runCli(['check', '--root', dir]).code, 0);
});
