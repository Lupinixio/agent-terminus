// `boundaries lint-rules`: finds manifest-owned identifiers restated in agent
// rules files. Limits belong in manifests; rules files should point to them.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { walkFiles } from './files.js';
import { hasGlobChars, matchGlob } from './glob.js';

/**
 * @typedef {import('./types.js').Project} Project
 * @typedef {{ id: string, file: string, key: string }} Owned
 * @typedef {{ file: string, line: number, col: number, id: string, owner: string, key: string }} Finding
 */

export const DEFAULT_RULE_FILES = Object.freeze([
  'CLAUDE.md',
  '**/CLAUDE.md',
  'AGENTS.md',
  '**/AGENTS.md',
  'GEMINI.md',
  '.claude/rules/**/*.md',
  '.claude/agents/**/*.md',
  '.claude/commands/**/*.md',
  '.cursor/rules/**',
  '.cursorrules',
  '.windsurfrules',
  '.github/copilot-instructions.md',
  '.github/instructions/**/*.md',
]);

const NEVER_SCANNED = ['.claude/worktrees', '.boundaries'];

/**
 * Identifiers owned by manifests (pure).
 * @param {Project} project
 * @returns {Owned[]}
 */
export function ownedIdentifiers(project) {
  /** @type {Owned[]} */
  const out = [];
  for (const m of project.manifests) {
    /** @param {string} id @param {string} key */
    const add = (id, key) => out.push({ id, file: m.file, key });
    m.entrypoints.forEach((g, i) => {
      for (const entry of g.exact) {
        add(entry, `entrypoints[${i}].exact`);
        const match = /^[A-Z]+\s+(\/\S*)$/.exec(entry.trim());
        if (match && match[1] !== '/') add(match[1], `entrypoints[${i}].exact`);
      }
    });
    for (const name of m.secrets?.names ?? []) add(name, 'runtime.secrets.names');
    for (const host of m.bind?.hosts ?? []) add(host, 'runtime.bind.hosts');
    if (m.imports) {
      for (const kind of /** @type {const} */ (['internal', 'external', 'builtin'])) {
        const list = m.imports[kind];
        if (list === 'any') continue;
        for (const entry of list) {
          if (kind === 'internal' && /[./]/.test(entry.target)) add(entry.target, `imports.${kind}`);
          for (const from of entry.onlyFrom ?? []) if (/[./]/.test(from)) add(from, `imports.${kind}`);
        }
      }
    }
    for (const call of m.calls ?? []) {
      if (call.pattern.includes('.') && !call.pattern.includes('*')) add(call.pattern, 'calls.forbidden');
    }
    for (const p of m.protected) if (!hasGlobChars(p)) add(p, 'protected.paths');
  }
  return out;
}

/** @param {string} text */
function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Findings in one file's text (pure).
 * @param {string} text
 * @param {string} file
 * @param {Owned[]} owned
 * @param {string[]} allow
 * @returns {Finding[]}
 */
export function lintText(text, file, owned, allow) {
  const allowed = new Set(allow);
  const ids = owned.filter((o) => !allowed.has(o.id));
  /** @type {Finding[]} */
  const findings = [];
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  lines.forEach((line, i) => {
    /** @type {[number, number][]} */
    const pointers = [];
    for (const m of line.matchAll(/\.boundaries\/\S*/g)) pointers.push([m.index, m.index + m[0].length]);
    const seen = new Set();
    for (const o of ids) {
      const tail = o.id.includes('.') ? '(?![\\w]|\\.\\w)' : '(?![\\w])';
      const re = new RegExp(`(?<![\\w])${escapeRegExp(o.id)}${tail}`, 'g');
      for (const m of line.matchAll(re)) {
        const start = m.index;
        if (pointers.some(([a, b]) => start >= a && start < b)) continue;
        const id = `${start}:${o.id}`;
        if (seen.has(id)) continue;
        seen.add(id);
        findings.push({ file, line: i + 1, col: start + 1, id: o.id, owner: o.file, key: o.key });
      }
    }
  });
  return findings.sort((a, b) => a.line - b.line || a.col - b.col);
}

/**
 * Rules files of a project: the given globs (or kit.toml's, or the defaults).
 * @param {Project} project
 * @param {string[] | null} [globs]
 */
export function ruleFiles(project, globs = null) {
  const patterns = globs ?? project.kit.rulesLint.files ?? [...DEFAULT_RULE_FILES];
  const nocase = process.platform === 'win32';
  const skip = (/** @type {string} */ rel) => NEVER_SCANNED.some((d) => rel === d || rel.startsWith(`${d}/`));
  return walkFiles(project.root, '', { skip }).filter((rel) => !skip(rel) && patterns.some((g) => matchGlob(g, rel, { nocase })));
}

/**
 * @param {Project} project
 * @param {{ files?: string[] | null }} [options]
 * @returns {Finding[]}
 */
export function lintRules(project, options = {}) {
  const owned = ownedIdentifiers(project);
  return ruleFiles(project, options.files ?? null).flatMap((rel) =>
    lintText(readFileSync(path.join(project.root, rel), 'utf8'), rel, owned, project.kit.rulesLint.allow),
  );
}

/** @param {Finding} f */
export function formatFinding(f) {
  return `${f.file}:${f.line}:${f.col} ${f.id} (owned by ${f.owner} ${f.key})`;
}
