// The kit's own limits hold under both adapters, the example validates, and each
// adapter skips the other language's fixtures instead of failing on them.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runNode, runPython } from './helpers.js';

test('dogfood: boundaries check passes with the Node adapter', () => {
  const r = runNode(['check']);
  assert.equal(r.code, 0, r.stdout + r.stderr);
});

test('dogfood: boundaries check passes with the Python adapter', () => {
  const r = runPython(['check']);
  assert.equal(r.code, 0, r.stdout + r.stderr);
});

test('examples validate with both adapters', () => {
  for (const run of [runNode, runPython]) {
    const r = run(['validate', '--root', 'examples/web-dashboard']);
    assert.equal(r.code, 0, r.stdout + r.stderr);
  }
});

test('each adapter skips the other language and passes its own fixtures', () => {
  const cases = [
    { run: runNode, own: 'fixtures/node', other: 'fixtures/python' },
    { run: runPython, own: 'fixtures/python', other: 'fixtures/node' },
  ];
  for (const { run, own, other } of cases) {
    assert.equal(run(['check', '--root', `${own}/passing`]).code, 0);
    assert.equal(run(['check', '--root', `${own}/violating`]).code, 1);
    for (const variant of ['passing', 'violating']) {
      const r = run(['check', '--root', `${other}/${variant}`, '--format', 'json']);
      assert.equal(r.code, 0, r.stdout + r.stderr);
      assert.deepEqual(
        JSON.parse(r.stdout).skipped.map((/** @type {{ component: string }} */ s) => s.component),
        ['dashboard'],
      );
    }
  }
});
