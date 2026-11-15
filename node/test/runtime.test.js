import assert from 'node:assert/strict';
import { test } from 'node:test';
import { captureOutput, checkBind, checkSecrets } from '../src/checks/runtime.js';
import { loadProject } from '../src/manifest.js';
import { findLeaks, makeSentinel, sentinelForms } from '../src/sentinels.js';
import { assertNoSecret, withSecretSentinels } from '../src/testing.js';
import { copyFixture, REPO, writeFiles } from './helpers/tmp.js';

test('bind: violating fixture binds to 0.0.0.0', async () => {
  const project = await loadProject(`${REPO}/fixtures/node/violating`);
  const found = await checkBind(project, project.manifests[0]);
  assert.deepEqual(
    found.map((v) => [v.check, v.key, v.message]),
    [['runtime.bind', 'runtime.bind.hosts', 'binds to 0.0.0.0, which is not in runtime.bind.hosts']],
  );
  const passing = await loadProject(`${REPO}/fixtures/node/passing`);
  assert.deepEqual(await checkBind(passing, passing.manifests[0]), []);
});

test('bind: an empty provider result is a violation', async (t) => {
  const dir = copyFixture(t, 'fixtures/node/passing');
  writeFiles(dir, { 'src/dashboard/boundary.ts': 'export function bindHosts(): string[] { return []; }\n' });
  const project = await loadProject(dir);
  const found = await checkBind(project, project.manifests[0]);
  assert.match(found[0].message, /returned no host/);
});

test('sentinel shape and forms', () => {
  const s = makeSentinel();
  assert.match(s, /^bk_[0-9a-f]{32}$/);
  const labels = new Set(sentinelForms(s).map(([label]) => label));
  for (const label of ['raw', 'first half', 'second half', 'repr', 'base64']) assert.ok(labels.has(label), label);
});

test('every encoding of a leak is found', () => {
  const s = makeSentinel();
  const sentinels = { API_TOKEN: s };
  const leaks = [
    `token=${s}`,
    `prefix ${s.slice(3, 19)} only`,
    `tail ${s.slice(19)}`,
    encodeURIComponent(`a=${s}&b`),
    JSON.stringify({ t: s }),
    `'${s}'`,
    Buffer.from(`Authorization: Basic user:${s}`).toString('base64'),
    Buffer.from(`x${s}`).toString('base64url'),
    Buffer.from(`xy${s}yz`).toString('base64'),
  ];
  for (const text of leaks) {
    assert.equal(findLeaks([{ source: 's', text }], sentinels).length, 1, text);
  }
  assert.deepEqual(findLeaks([{ source: 's', text: 'nothing here' }], sentinels), []);
});

test('assertNoSecret lists every leak', () => {
  const s = makeSentinel();
  assert.doesNotThrow(() => assertNoSecret(['clean'], { A: s }));
  assert.throws(
    () => assertNoSecret([`x ${s}`, 'ok', Buffer.from(s).toString('base64')], { A: s }),
    (/** @type {Error} */ e) => e.name === 'AssertionError' && /text #0/.test(e.message) && /text #2/.test(e.message),
  );
});

test('withSecretSentinels hands one sentinel per name to the callback', async () => {
  const seen = await withSecretSentinels(['A_KEY', 'B_KEY'], (sentinels) => sentinels);
  assert.deepEqual(Object.keys(seen), ['A_KEY', 'B_KEY']);
  for (const v of Object.values(seen)) assert.match(v, /^bk_[0-9a-f]{32}$/);
});

test('captureOutput captures console and stdout, then restores them', async () => {
  const original = console.log;
  const { value, stdout, stderr } = await captureOutput(async () => {
    console.log('to stdout');
    console.error('to stderr');
    process.stdout.write('raw write\n');
    return 7;
  });
  assert.equal(value, 7);
  assert.equal(stdout, 'to stdout\nraw write\n');
  assert.equal(stderr, 'to stderr\n');
  assert.equal(console.log, original);
});

test('secrets: a probe output scan with no leak passes; a failing probe is a config error', async (t) => {
  const dir = copyFixture(t, 'fixtures/node/passing');
  writeFiles(dir, {
    'src/dashboard/probe.js': "export function clean() { console.log('rendered'); return ['<h1>ok</h1>']; }\nexport function broken() { throw new Error('boom'); }\n",
  });
  const project = await loadProject(dir);
  const manifest = project.manifests[0];
  manifest.secrets = { names: ['DASHBOARD_KEY'], probe: './src/dashboard/probe.js#clean' };
  assert.deepEqual(await checkSecrets(project, manifest), []);
  manifest.secrets = { names: ['DASHBOARD_KEY'], probe: './src/dashboard/probe.js#broken' };
  await assert.rejects(checkSecrets(project, manifest), /probe .* failed: boom/);
});
