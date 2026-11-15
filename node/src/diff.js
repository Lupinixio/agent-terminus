// `boundaries diff --base <ref>`: a change under .boundaries/ (other than the
// generated files) must add a new decision record that did not exist at <ref>.
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parse as parseToml } from 'smol-toml';

/**
 * @param {string} root
 * @param {string[]} args
 */
function git(root, args) {
  const r = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' });
  return { ok: r.status === 0, out: r.stdout ?? '', err: r.stderr ?? '' };
}

/**
 * Decision paths listed in one TOML text (manifest or kit.toml); tolerant of
 * invalid files, which `check` reports.
 * @param {string} text
 * @returns {string[]}
 */
export function decisionsIn(text) {
  try {
    /** @type {any} */
    const raw = parseToml(text);
    const list = raw?.component?.decisions ?? raw?.decisions ?? [];
    return Array.isArray(list) ? list.filter((d) => typeof d === 'string') : [];
  } catch {
    return [];
  }
}

/** @param {string} file */
function isGenerated(file) {
  return file.startsWith('.boundaries/generated/');
}

/**
 * @param {{ root: string, base: string }} options
 * @returns {{ code: 0 | 1 | 2, lines: string[] }}
 */
export function diffBoundaries({ root, base }) {
  if (!git(root, ['rev-parse', '--verify', '--quiet', `${base}^{commit}`]).ok) {
    return { code: 2, lines: [`unknown git ref "${base}"`] };
  }
  const changed = new Set([
    ...git(root, ['diff', '--relative', '--name-only', base, '--', '.boundaries']).out.split('\n'),
    ...git(root, ['ls-files', '--others', '--exclude-standard', '--', '.boundaries']).out.split('\n'),
  ]);
  const relevant = [...changed].map((f) => f.trim()).filter((f) => f && !isGenerated(f)).sort();
  if (relevant.length === 0) return { code: 0, lines: ['no manifest changes since ' + base] };

  const dir = path.join(root, '.boundaries');
  const nowFiles = existsSync(dir) ? readdirSync(dir).filter((n) => n.endsWith('.toml')) : [];
  const now = new Set(nowFiles.flatMap((n) => decisionsIn(readFileSync(path.join(dir, n), 'utf8'))));
  const baseFiles = git(root, ['ls-tree', '--name-only', base, '.boundaries/'])
    .out.split('\n')
    .map((f) => f.trim())
    .filter((f) => f.endsWith('.toml'));
  const before = new Set(baseFiles.flatMap((f) => decisionsIn(git(root, ['show', `${base}:./${f}`]).out)));
  const added = [...now].filter((d) => !before.has(d));
  const fresh = added.filter((d) => existsSync(path.join(root, d)) && !git(root, ['cat-file', '-e', `${base}:./${d}`]).ok);
  if (fresh.length > 0) {
    return { code: 0, lines: [`.boundaries/ changed (${relevant.join(', ')}); new decision record(s): ${fresh.join(', ')}`] };
  }
  return {
    code: 1,
    lines: [
      `.boundaries/ changed since ${base}: ${relevant.join(', ')}`,
      'but no new decision record was added. Link a new record from the changed manifest',
      '(component.decisions) or from kit.toml (decisions); it must exist and must not exist at the base.',
    ],
  };
}
