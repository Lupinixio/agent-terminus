import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { parse } from 'smol-toml';
import { validateKit, validateManifest } from '../src/validate.js';
import { REPO } from './helpers/tmp.js';

const ajv = new Ajv2020({ allErrors: true });
const schemas = {
  manifest: ajv.compile(JSON.parse(readFileSync(path.join(REPO, 'schema/manifest.schema.json'), 'utf8'))),
  kit: ajv.compile(JSON.parse(readFileSync(path.join(REPO, 'schema/kit.schema.json'), 'utf8'))),
};
const validators = { manifest: validateManifest, kit: validateKit };

for (const kind of /** @type {const} */ (['manifest', 'kit'])) {
  const dir = path.join(REPO, 'schema/fixtures', kind);
  for (const name of readdirSync(path.join(dir, 'valid'))) {
    test(`${kind} valid: ${name}`, () => {
      const raw = parse(readFileSync(path.join(dir, 'valid', name), 'utf8'));
      assert.equal(schemas[kind](raw), true, JSON.stringify(schemas[kind].errors));
      assert.deepEqual(validators[kind](raw, name), []);
    });
  }
  for (const name of readdirSync(path.join(dir, 'invalid'))) {
    test(`${kind} invalid: ${name}`, () => {
      const text = readFileSync(path.join(dir, 'invalid', name), 'utf8');
      const expected = /^# expect: (\S+)/.exec(text)?.[1];
      assert.ok(expected, 'invalid fixtures start with "# expect: <key>"');
      const raw = parse(text);
      assert.equal(schemas[kind](raw), false, 'the JSON schema rejects it');
      const keys = validators[kind](raw, name).map((p) => p.key);
      assert.ok(keys.includes(expected), `expected a problem at ${expected}, got ${JSON.stringify(keys)}`);
    });
  }
}
