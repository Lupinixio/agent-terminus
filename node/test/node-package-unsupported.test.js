import assert from 'node:assert/strict';
import { test } from 'node:test';
import { makeTmp, minimalProject, runCli } from './helpers/tmp.js';

test('component.package in a node manifest gives exit 3', (t) => {
  const dir = makeTmp(
    t,
    minimalProject({
      '.boundaries/ui.toml': `schema_version = 1

[component]
name = "ui"
language = "node"
root = "src/ui"
package = "ui"
principle = "UI only."
decisions = ["docs/decisions/0001-boundaries.md"]
`,
      'src/ui/a.js': '',
    }),
  );
  const r = runCli(['check', '--root', dir, '--format', 'json']);
  assert.equal(r.code, 3, r.stdout + r.stderr);
  const report = JSON.parse(r.stdout);
  assert.deepEqual(
    report.errors.map((/** @type {{ key: string }} */ e) => e.key),
    ['component.package'],
  );
  assert.match(report.errors[0].message, /key component\.package is not checked by the node adapter/);
});
