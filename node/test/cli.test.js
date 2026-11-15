import assert from 'node:assert/strict';
import { test } from 'node:test';
import { main } from '../src/cli.js';
import { VERSION } from '../src/version.js';
import { makeTmp, minimalProject, runCli } from './helpers/tmp.js';

/**
 * Runs the CLI in-process.
 * @param {string[]} args
 * @param {string} cwd
 */
async function run(args, cwd) {
  let out = '';
  let err = '';
  const code = await main(args, { out: (s) => (out += s), err: (s) => (err += s), cwd });
  return { code, out, err };
}

test('usage errors exit 2', async (t) => {
  const dir = makeTmp(t, minimalProject());
  assert.equal((await run([], dir)).code, 2);
  assert.equal((await run(['frobnicate'], dir)).code, 2);
  assert.equal((await run(['check', '--bogus'], dir)).code, 2);
  assert.equal((await run(['check', '--format', 'xml'], dir)).code, 2);
  assert.equal((await run(['--help'], dir)).code, 0);
  assert.equal((await run(['--version'], dir)).out.trim(), VERSION);
});

test('no .boundaries directory is a config error', async (t) => {
  const dir = makeTmp(t, { 'a.txt': '' });
  const r = await run(['check'], dir);
  assert.equal(r.code, 3);
  assert.match(r.out, /no \.boundaries\/ directory/);
});

test('keys --json', async (t) => {
  const dir = makeTmp(t);
  const r = await run(['keys', '--json'], dir);
  const payload = JSON.parse(r.out);
  assert.equal(payload.adapter, 'node');
  assert.deepEqual(payload.schema_versions, [1]);
  assert.ok(payload.supported_keys.includes('runtime.secrets.probe'));
});

test('JSON report shape', async (t) => {
  const dir = makeTmp(t, minimalProject());
  const r = await run(['check', '--format', 'json'], dir);
  assert.equal(r.code, 4);
  assert.deepEqual(Object.keys(JSON.parse(r.out)).sort(), ['adapter', 'errors', 'results', 'schema_version', 'skipped', 'stale']);
});

test('python manifests are skipped, not errors', async (t) => {
  const dir = makeTmp(
    t,
    minimalProject({
      '.boundaries/web.toml': `schema_version = 1

[component]
name = "web"
language = "python"
root = "src/web"
package = "web"
principle = "Web only."
decisions = ["docs/decisions/0001-boundaries.md"]

[runtime.secrets]
names = ["TOKEN"]
probe = "web.boundary:probe"
`,
      'src/web/__init__.py': '',
    }),
  );
  await run(['generate'], dir);
  const r = await run(['check', '--format', 'json'], dir);
  assert.equal(r.code, 0, r.out);
  assert.deepEqual(JSON.parse(r.out).skipped, [{ component: 'web', reason: 'language python is checked by its own adapter' }]);
});

test('adapter rules: stem, decisions, root, protected paths', async (t) => {
  const dir = makeTmp(
    t,
    minimalProject({
      '.boundaries/ui.toml': `schema_version = 1

[component]
name = "web"
language = "node"
root = "src/missing"
principle = "UI."
decisions = ["docs/decisions/0002-missing.md"]

[[entrypoints]]
name = "routes"
provider = "ui.boundary:routes"
exact = []

[protected]
paths = ["src/nope.js", "src/**/*.nope"]
`,
    }),
  );
  const r = await run(['validate', '--format', 'json'], dir);
  assert.equal(r.code, 3);
  const keys = JSON.parse(r.out).errors.map((/** @type {{ key: string }} */ e) => e.key);
  assert.deepEqual(keys.sort(), [
    'component.decisions[0]',
    'component.name',
    'component.root',
    'entrypoints[0].provider',
    'protected.paths[0]',
    'protected.paths[1]',
  ]);
});

test('bin runs end to end', (t) => {
  const dir = makeTmp(t, minimalProject());
  assert.equal(runCli(['generate', '--root', dir]).code, 0);
  const r = runCli(['check', '--root', dir]);
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /boundaries \(node\): ok/);
});

test('fixtures: passing exits 0, violating exits 1 with every check represented', (t) => {
  const passing = runCli(['check', '--root', 'fixtures/node/passing']);
  assert.equal(passing.code, 0, passing.stdout + passing.stderr);
  const violating = runCli(['check', '--root', 'fixtures/node/violating', '--format', 'json']);
  assert.equal(violating.code, 1, violating.stdout + violating.stderr);
  const report = JSON.parse(violating.stdout);
  const checks = new Set(report.results.map((/** @type {{ check: string }} */ r) => r.check));
  assert.deepEqual([...checks].sort(), ['calls', 'entrypoints', 'imports', 'runtime.bind']);
  const tmp = makeTmp(t);
  assert.ok(tmp);
});

test('checkBoundaries returns the report', async () => {
  const { checkBoundaries } = await import('../src/testing.js');
  const report = await checkBoundaries({ root: 'fixtures/node/passing' });
  assert.deepEqual(report.results, []);
  assert.deepEqual(report.errors, []);
});
