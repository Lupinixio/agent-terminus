import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { matchGlob as hookMatch } from '../../hooks/protect-boundaries.mjs';
import { literalPrefix, matchGlob } from '../src/glob.js';
import { REPO } from './helpers/tmp.js';

/** @type {{ glob: string, path: string, match: boolean, nocase?: boolean }[]} */
const cases = JSON.parse(readFileSync(path.join(REPO, 'schema/fixtures/globs.json'), 'utf8'));

test('shared glob cases (adapter and hook)', () => {
  for (const c of cases) {
    const options = { nocase: c.nocase ?? false };
    assert.equal(matchGlob(c.glob, c.path, options), c.match, `${c.glob} ~ ${c.path}`);
    assert.equal(hookMatch(c.glob, c.path, options), c.match, `hook: ${c.glob} ~ ${c.path}`);
  }
});

test('backslash paths are normalized', () => {
  assert.equal(matchGlob('.boundaries/**', '.boundaries\\web.toml'), true);
});

test('literal prefix', () => {
  assert.equal(literalPrefix('.boundaries/**'), '.boundaries/');
  assert.equal(literalPrefix('CODEOWNERS'), 'CODEOWNERS');
});
