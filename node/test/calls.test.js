import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkCalls, findCalls, matchCall } from '../src/checks/calls.js';
import { loadProject } from '../src/manifest.js';
import { copyFixture, REPO, writeFiles } from './helpers/tmp.js';

/** @param {string} code @param {string} [file] */
function names(code, file = 'a.js') {
  return findCalls(code, file).map((c) => (c.known ? '' : '?') + c.segments.join('.'));
}

test('aliases resolve through imports and require', () => {
  assert.deepEqual(names("import { exec as x } from 'node:child_process';\nx('ls');"), ['child_process.exec']);
  assert.deepEqual(names("import * as cp from 'child_process';\ncp.spawn('ls');"), ['child_process.spawn']);
  assert.deepEqual(names("import fs from 'node:fs';\nfs.writeFileSync('a', 'b');"), ['fs.writeFileSync']);
  assert.deepEqual(names("const { exec: run } = require('child_process');\nrun('x');", 'a.cjs'), ['require', 'child_process.exec']);
  assert.deepEqual(names("const cp = require('node:child_process');\ncp.exec('x');", 'a.cjs'), ['require', 'child_process.exec']);
  assert.deepEqual(names("require('child_process').exec('x');", 'a.cjs'), ['child_process.exec', 'require']);
  assert.deepEqual(names("import { readFile } from 'node:fs/promises';\nawait readFile('x');"), ['fs.promises.readFile']);
});

test('bare names, globals, new and unknown receivers', () => {
  assert.deepEqual(names("fetch('x'); globalThis.fetch('y'); eval('1'); new Function('x');"), ['fetch', 'fetch', 'eval', 'Function']);
  assert.deepEqual(names("import fetch from 'node-fetch';\nfetch('x');"), ['node-fetch']);
  assert.deepEqual(names('this.el.open(); getEl().innerHTML.trim?.();'), ['?<expression>.el.open', '?<expression>.innerHTML.trim', 'getEl']);
});

test('TypeScript and JSX parse', () => {
  assert.deepEqual(names('const n: number = parseInt("1" as string);\neval!(String(n));', 'a.ts'), ['parseInt', 'eval', 'String']);
  assert.deepEqual(names('export const C = () => <div onClick={() => alert(1)} />;', 'a.jsx'), ['alert']);
  assert.deepEqual(names('export const C = (p: { n: number }) => <b>{format(p.n)}</b>;', 'a.tsx'), ['format']);
});

test('pattern semantics', () => {
  assert.equal(matchCall('fetch', ['fetch'], true), true);
  assert.equal(matchCall('fetch', ['window', 'fetch'], true), false);
  assert.equal(matchCall('child_process.*', ['child_process', 'exec'], true), true);
  assert.equal(matchCall('fs.write*', ['fs', 'writeFileSync'], true), true);
  assert.equal(matchCall('fs.write*', ['fs', 'readFileSync'], true), false);
  assert.equal(matchCall('*.open', ['<expression>', 'open'], false), true);
  assert.equal(matchCall('*.open', ['open'], true), false);
  assert.equal(matchCall('os.system', ['<expression>', 'system'], false), false);
});

test('fixtures: passing has no forbidden call, violating has three', async () => {
  for (const [fixture, expected] of /** @type {const} */ ([
    ['passing', []],
    [
      'violating',
      [
        'src/dashboard/app.js:31 child_process.exec',
        'src/dashboard/app.js:32 fetch',
        'src/dashboard/app.js:32 fs.readFileSync',
      ],
    ],
  ])) {
    const project = await loadProject(`${REPO}/fixtures/node/${fixture}`);
    const found = await checkCalls(project, project.manifests[0]);
    assert.deepEqual(
      found.map((v) => `${v.location} ${/call to (\S+)/.exec(v.message)?.[1]}`),
      expected,
    );
  }
});

test('unparseable source is a config error', async (t) => {
  const dir = copyFixture(t, 'fixtures/node/passing');
  writeFiles(dir, { 'src/dashboard/broken.js': 'export const x = (;\n' });
  const project = await loadProject(dir);
  await assert.rejects(checkCalls(project, project.manifests[0]), (/** @type {any} */ e) => e.name === 'ConfigError');
});
