import assert from 'node:assert/strict';
import { test } from 'node:test';
import { toDepcruiseRules } from '../src/checks/depcruise-rules.js';
import { manifestFromRaw } from '../src/manifest.js';

const NPM = ['npm', 'npm-dev', 'npm-optional', 'npm-peer', 'npm-bundled', 'npm-no-pkg', 'npm-unknown'];

const manifest = manifestFromRaw(
  {
    schema_version: 1,
    component: {
      name: 'ui',
      language: 'node',
      root: 'src/ui',
      exclude: ['src/ui/**/*.test.js'],
      principle: 'p',
      decisions: ['d.md'],
    },
    imports: {
      internal: ['src/api', { target: 'src/shared/fmt.js', only_from: ['src/ui/table'] }],
      external: ['smol-toml', { target: '@scope/pkg', only_from: ['src/ui/a.js'] }],
      builtin: ['path'],
    },
  },
  '.boundaries/ui.toml',
);

test('golden: rules for a node manifest', () => {
  const from = { path: '^src/ui(/|$)', pathNot: ['^src/ui/(?:.*/)?[^/]*\\.test\\.js$'] };
  assert.deepEqual(toDepcruiseRules(manifest), [
    {
      name: 'boundaries/ui/internal',
      severity: 'error',
      comment: '.boundaries/ui.toml: imports.internal does not allow this import',
      from,
      to: {
        dependencyTypesNot: ['core', ...NPM],
        couldNotResolve: false,
        pathNot: ['^src/ui(/|$)', '^src/api(/|$)', '^src/shared/fmt\\.js(/|$)'],
      },
    },
    {
      name: 'boundaries/ui/internal-only-from-1',
      severity: 'error',
      comment: '.boundaries/ui.toml: imports.internal allows src/shared/fmt.js only from src/ui/table',
      from: { path: '^src/ui(/|$)', pathNot: [...from.pathNot, '^src/ui/table(/|$)'] },
      to: { dependencyTypesNot: ['core', ...NPM], couldNotResolve: false, path: '^src/shared/fmt\\.js(/|$)' },
    },
    {
      name: 'boundaries/ui/external',
      severity: 'error',
      comment: '.boundaries/ui.toml: imports.external does not allow this import',
      from,
      to: { dependencyTypes: NPM, pathNot: ['(^|/)node_modules/smol-toml/', '(^|/)node_modules/@scope/pkg/'] },
    },
    {
      name: 'boundaries/ui/external-only-from-1',
      severity: 'error',
      comment: '.boundaries/ui.toml: imports.external allows @scope/pkg only from src/ui/a.js',
      from: { path: '^src/ui(/|$)', pathNot: [...from.pathNot, '^src/ui/a\\.js(/|$)'] },
      to: { dependencyTypes: NPM, path: '(^|/)node_modules/@scope/pkg/' },
    },
    {
      name: 'boundaries/ui/builtin',
      severity: 'error',
      comment: '.boundaries/ui.toml: imports.builtin does not allow this import',
      from,
      to: { dependencyTypes: ['core'], pathNot: ['^path(/|$)'] },
    },
    {
      name: 'boundaries/ui/unresolvable',
      severity: 'error',
      comment: '.boundaries/ui.toml: every import must resolve so the import limits can be checked',
      from,
      to: { couldNotResolve: true },
    },
  ]);
});

test('"any" lists produce no rule; no [imports] produces nothing', () => {
  const any = manifestFromRaw(
    {
      schema_version: 1,
      component: { name: 'x', language: 'node', root: 'x', principle: 'p', decisions: ['d.md'] },
      imports: { internal: 'any', external: 'any', builtin: 'any' },
    },
    '.boundaries/x.toml',
  );
  assert.deepEqual(
    toDepcruiseRules(any).map((r) => r.name),
    ['boundaries/x/unresolvable'],
  );
  assert.deepEqual(toDepcruiseRules({ ...any, imports: null }), []);
});
