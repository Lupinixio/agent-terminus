import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { parse } from 'yaml';
import { blockPatterns, patternCovers } from '../src/codeowners.js';
import { BUILTIN_PROTECTED } from '../src/support.js';
import { REPO } from './helpers/tmp.js';

test('workflow template has python and node jobs running the checks', () => {
  const doc = parse(readFileSync(path.join(REPO, 'templates/github/boundaries.yml'), 'utf8'));
  assert.equal(doc.name, 'boundaries');
  assert.ok('pull_request' in doc.on);
  assert.deepEqual(doc.on.push.branches, ['main']);
  assert.deepEqual(Object.keys(doc.jobs).sort(), ['node', 'python']);
  /** @param {string} job */
  const runs = (job) => doc.jobs[job].steps.map((/** @type {{ run?: string }} */ s) => s.run ?? '').join('\n');
  assert.equal(doc.jobs.python.name, 'python');
  assert.equal(doc.jobs.node.name, 'node');
  assert.match(runs('python'), /uv sync --locked/);
  assert.match(runs('python'), /uv run boundaries check/);
  assert.match(runs('node'), /npx boundaries check/);
  assert.match(runs('node'), /npx boundaries lint-rules/);
  assert.match(runs('node'), /npx boundaries diff --base origin\/\$\{\{ github\.base_ref \}\}/);
  const checkout = doc.jobs.python.steps.find((/** @type {{ uses?: string }} */ s) => s.uses?.startsWith('actions/checkout'));
  assert.equal(checkout.with['fetch-depth'], 0);
});

test('CODEOWNERS snippet covers every built-in protected path', () => {
  const text = readFileSync(path.join(REPO, 'templates/CODEOWNERS.snippet'), 'utf8');
  const patterns = blockPatterns(text);
  assert.ok(patterns, 'snippet has the marker block');
  for (const glob of BUILTIN_PROTECTED) {
    assert.ok(
      patterns.some((p) => patternCovers(p, glob)),
      `${glob} is covered`,
    );
  }
  assert.match(text, /@your-org\/boundary-owners/);
});
