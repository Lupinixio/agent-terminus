// Every key the schema accepts is checked by some adapter, and docs/manifest.md
// shows exactly what each adapter checks.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { REPO, runNode, runPython, schemaLeafKeys } from './helpers.js';

/** @param {import('./helpers.js').Run} r @returns {{ adapter: string, schema_versions: number[], supported_keys: string[] }} */
function keysOf(r) {
  assert.equal(r.code, 0, r.stderr);
  return JSON.parse(r.stdout);
}

const node = keysOf(runNode(['keys', '--json']));
const python = keysOf(runPython(['keys', '--json']));
const schema = JSON.parse(readFileSync(path.join(REPO, 'schema/manifest.schema.json'), 'utf8'));

test('adapters report their name and schema versions', () => {
  assert.equal(node.adapter, 'node');
  assert.equal(python.adapter, 'python');
  assert.deepEqual(node.schema_versions, [1]);
  assert.deepEqual(python.schema_versions, [1]);
});

test('the union of supported keys equals every leaf key of the schema', () => {
  const union = [...new Set([...node.supported_keys, ...python.supported_keys])].sort();
  assert.deepEqual(union, schemaLeafKeys(schema));
});

test('docs/manifest.md support matrix matches the adapters', () => {
  const text = readFileSync(path.join(REPO, 'docs/manifest.md'), 'utf8').replace(/\r\n/g, '\n');
  const block = /<!-- keys:start -->\n([\s\S]*?)<!-- keys:end -->/.exec(text);
  assert.ok(block, 'docs/manifest.md has a <!-- keys:start --> ... <!-- keys:end --> block');
  /** @type {Record<string, string[]>} */
  const columns = { python: [], node: [] };
  const rows = block[1].split('\n').filter((l) => l.startsWith('| `'));
  for (const row of rows) {
    const [key, py, nd] = row.split('|').slice(1, 4).map((c) => c.trim());
    const name = key.replace(/`/g, '');
    if (py === 'yes') columns.python.push(name);
    if (nd === 'yes') columns.node.push(name);
  }
  assert.deepEqual(columns.python.sort(), [...python.supported_keys].sort());
  assert.deepEqual(columns.node.sort(), [...node.supported_keys].sort());
  assert.equal(rows.length, schemaLeafKeys(schema).length, 'one row per schema key');
});
