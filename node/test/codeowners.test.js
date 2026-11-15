import assert from 'node:assert/strict';
import { test } from 'node:test';
import { blockPatterns, codeownersBlock, patternCovers, toCodeownersPattern } from '../src/codeowners.js';
import { protectedGlobs } from '../src/index-file.js';
import { loadProject } from '../src/manifest.js';
import { copyFixture, REPO, runCli, writeFiles } from './helpers/tmp.js';

test('glob conversion', () => {
  assert.equal(toCodeownersPattern('.boundaries/**'), '/.boundaries/');
  assert.equal(toCodeownersPattern('CODEOWNERS'), '/CODEOWNERS');
  assert.equal(toCodeownersPattern('tests/**/test_*.py'), '/tests/**/test_*.py');
  assert.equal(patternCovers('/src/', 'src/dashboard/boundary.ts'), true);
  assert.equal(patternCovers('/src/a.ts', 'src/b.ts'), false);
});

test('block covers the index', async () => {
  const project = await loadProject(`${REPO}/fixtures/node/passing`);
  const block = codeownersBlock(project, '@acme/owners');
  const patterns = blockPatterns(block) ?? [];
  for (const glob of protectedGlobs(project)) assert.ok(patterns.some((p) => patternCovers(p, glob)), glob);
  assert.match(block, /\/src\/dashboard\/boundary\.ts @acme\/owners/);
});

test('CLI prints the block; a stale marker block gives exit 4; a fresh one passes', (t) => {
  const dir = copyFixture(t, 'fixtures/node/passing');
  const printed = runCli(['codeowners', '--root', dir, '--owner', '@acme/owners']);
  assert.equal(printed.code, 0);
  writeFiles(dir, { '.github/CODEOWNERS': '# BEGIN boundaries-kit\n/.boundaries/ @acme/owners\n# END boundaries-kit\n' });
  const stale = runCli(['check', '--root', dir, '--format', 'json']);
  assert.equal(stale.code, 4, stale.stdout);
  assert.deepEqual(JSON.parse(stale.stdout).stale, ['.github/CODEOWNERS']);
  writeFiles(dir, { '.github/CODEOWNERS': `* @acme/everyone\n\n${printed.stdout}` });
  assert.equal(runCli(['check', '--root', dir]).code, 0);
  assert.equal(runCli(['codeowners', '--root', dir, '--owner', 'not an owner']).code, 2);
});

test('CODEOWNERS without markers is not checked', (t) => {
  const dir = copyFixture(t, 'fixtures/node/passing');
  writeFiles(dir, { CODEOWNERS: '* @acme/everyone\n' });
  assert.equal(runCli(['check', '--root', dir]).code, 0);
});
