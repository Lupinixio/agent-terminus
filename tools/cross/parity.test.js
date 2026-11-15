// Both adapters produce the same bytes and share the same constants and version.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { BUILTIN_PROTECTED as HOOK_PROTECTED, KIT_VERSION } from '../../hooks/protect-boundaries.mjs';
import { buildIndex } from '../../node/src/index-file.js';
import { loadProject } from '../../node/src/manifest.js';
import { BUILTIN_PROTECTED as NODE_PROTECTED } from '../../node/src/support.js';
import { VERSION } from '../../node/src/version.js';
import { pythonEval, REPO, ROOTS } from './helpers.js';

const PY_INDEX =
  'import sys\n' +
  'from agent_terminus.index_file import build_index\n' +
  'from agent_terminus.manifest import load_project\n' +
  'p = load_project(sys.argv[1])\n' +
  'assert not p.problems, p.problems\n' +
  'sys.stdout.buffer.write(build_index(p).encode("utf-8"))\n';

for (const root of ROOTS) {
  test(`index.json is byte-identical from both adapters: ${root}`, async () => {
    const abs = path.join(REPO, root);
    const project = await loadProject(abs);
    assert.deepEqual(project.problems, []);
    const fromNode = buildIndex(project);
    const fromPython = pythonEval(PY_INDEX, [abs]);
    assert.equal(fromPython, fromNode);
    const committed = readFileSync(path.join(abs, '.boundaries/generated/index.json'), 'utf8').replace(/\r\n/g, '\n');
    assert.equal(committed, fromNode, 'the committed index is fresh');
  });
}

test('BUILTIN_PROTECTED is equal in the JSON, Node, Python and hook copies', () => {
  const canonical = JSON.parse(readFileSync(path.join(REPO, 'schema/builtin-protected.json'), 'utf8'));
  const fromPython = JSON.parse(
    pythonEval('import json\nfrom agent_terminus.support import BUILTIN_PROTECTED\nprint(json.dumps(list(BUILTIN_PROTECTED)))'),
  );
  assert.deepEqual([...NODE_PROTECTED], canonical);
  assert.deepEqual([...HOOK_PROTECTED], canonical);
  assert.deepEqual(fromPython, canonical);
});

test('versions are equal everywhere', () => {
  const pkg = JSON.parse(readFileSync(path.join(REPO, 'package.json'), 'utf8'));
  const pyproject = readFileSync(path.join(REPO, 'python/pyproject.toml'), 'utf8');
  const pyprojectVersion = /^version = "([^"]+)"/m.exec(pyproject)?.[1];
  const pythonVersion = pythonEval('import agent_terminus\nprint(agent_terminus.__version__)').trim();
  const changelog = readFileSync(path.join(REPO, 'CHANGELOG.md'), 'utf8');
  assert.equal(VERSION, pkg.version);
  assert.equal(KIT_VERSION, pkg.version);
  assert.equal(pyprojectVersion, pkg.version);
  assert.equal(pythonVersion, pkg.version);
  assert.ok(changelog.includes(`## [${pkg.version}]`), 'CHANGELOG has a section for the version');
});
