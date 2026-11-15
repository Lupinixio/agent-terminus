#!/usr/bin/env node
// agent-terminus: protect-boundaries hook (Claude Code PreToolUse).
//
// Asks (or denies) before an agent edits files that enforce the project's
// limits: `.boundaries/**`, this hook, agent settings, CODEOWNERS, the CI
// workflow, and every path listed in `.boundaries/generated/index.json`.
//
// Self-contained: Node built-ins only, safe to copy into a project as one file.
// Shell-command detection is best effort: a script that writes a protected file
// without naming it gets past this hook. The git pre-commit hook and the CI job
// behind CODEOWNERS catch that (see docs/protecting-checks.md).
//
// Other tools can import `decide()` and map its result to their own format.
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

export const KIT_VERSION = '0.1.0';

/** Built-in protected paths (copy of schema/builtin-protected.json). */
export const BUILTIN_PROTECTED = Object.freeze([
  '.boundaries/**',
  '.claude/hooks/protect-boundaries.mjs',
  '.claude/settings.json',
  '.claude/settings.local.json',
  '.githooks/pre-commit',
  '.github/workflows/boundaries.yml',
  '.github/CODEOWNERS',
  'CODEOWNERS',
  'docs/CODEOWNERS',
]);

const INDEX_FILE = path.join('.boundaries', 'generated', 'index.json');
const FILE_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
const SHELL_TOOLS = new Set(['Bash', 'PowerShell']);
const READ_ONLY = new Set([
  'cat', 'head', 'tail', 'less', 'more', 'grep', 'rg', 'ls', 'dir', 'wc', 'diff', 'type',
  'get-content', 'select-string',
]);
const READ_ONLY_GIT = new Set(['diff', 'log', 'show', 'status', 'blame']);
const READ_ONLY_BOUNDARIES = new Set(['check', 'validate', 'lint-rules', 'diff', 'keys', 'codeowners', 'generate']);

/** @param {string} text */
function escapeRegExp(text) {
  return text.replace(/[.+^${}()|[\]\\]/g, '\\$&');
}

/**
 * Glob match for `*`, `?` and `**` (same semantics as the adapters).
 * @param {string} glob
 * @param {string} relPath forward slashes, project-relative
 * @param {{ nocase?: boolean }} [options]
 */
export function matchGlob(glob, relPath, options = {}) {
  const segments = glob.replace(/\\/g, '/').split('/');
  let out = '';
  segments.forEach((segment, i) => {
    const last = i === segments.length - 1;
    if (segment === '**') {
      if (segments.length === 1) out += '.*';
      else if (i === 0) out += '(?:.*/)?';
      else if (last) out += '/.+';
      else out += '/(?:.*/)?';
      return;
    }
    if (i > 0 && segments[i - 1] !== '**') out += '/';
    for (const ch of segment) out += ch === '*' ? '[^/]*' : ch === '?' ? '[^/]' : escapeRegExp(ch);
  });
  return new RegExp(`^${out}$`, options.nocase ? 'i' : '').test(relPath.replace(/\\/g, '/'));
}

/** @param {string} dir */
function hasBoundaries(dir) {
  const candidate = path.join(dir, '.boundaries');
  return existsSync(candidate) && statSync(candidate).isDirectory();
}

/**
 * Nearest ancestor of `start` (inclusive) that contains a `.boundaries/` directory.
 * @param {string} start
 * @returns {string | null}
 */
export function findRoot(start) {
  let dir = path.resolve(start);
  for (;;) {
    if (hasBoundaries(dir)) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * Protected globs and decision for a project root. A corrupt index fails closed.
 * @param {string} root
 * @returns {{ globs: string[], decision: 'ask' | 'deny', corrupt: boolean }}
 */
export function loadIndex(root) {
  const file = path.join(root, INDEX_FILE);
  if (!existsSync(file)) return { globs: [...BUILTIN_PROTECTED], decision: 'ask', corrupt: false };
  try {
    const index = JSON.parse(readFileSync(file, 'utf8'));
    const extra = Array.isArray(index.protected) ? index.protected.filter((/** @type {unknown} */ g) => typeof g === 'string') : [];
    const decision = index.decision === 'deny' ? 'deny' : 'ask';
    return { globs: [...new Set([...BUILTIN_PROTECTED, ...extra])], decision, corrupt: false };
  } catch {
    return { globs: [...BUILTIN_PROTECTED], decision: 'ask', corrupt: true };
  }
}

/**
 * Splits a shell command into segments on `;`, `&&`, `||`, `|` and newlines.
 * @param {string} command
 */
function segmentsOf(command) {
  return command
    .split(/&&|\|\||[;|\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Whether a single command segment only reads.
 * @param {string} segment
 */
export function isReadOnlySegment(segment) {
  const stripped = segment
    .replace(/2>&1/g, ' ')
    .replace(/\d?>\s*\/dev\/null/g, ' ')
    .replace(/\d?>\s*\$null/gi, ' ');
  if (stripped.includes('>')) return false;
  let words = stripped.trim().split(/\s+/);
  if (words[0] === 'npx') {
    words = words.slice(1);
    while (words[0]?.startsWith('-')) words = words.slice(1);
  } else if (words[0] === 'uv' && words[1] === 'run') {
    words = words.slice(2);
    while (words[0]?.startsWith('-')) words = words.slice(1);
  }
  const [cmd = '', sub = ''] = words;
  const name = cmd.toLowerCase();
  if (READ_ONLY.has(name)) return true;
  if (name === 'git') return READ_ONLY_GIT.has(sub);
  if (name === 'boundaries') return READ_ONLY_BOUNDARIES.has(sub);
  return false;
}

/**
 * The first protected glob a command mentions (by `.boundaries` or a literal
 * prefix of at least 3 characters), or null.
 * @param {string} command
 * @param {string[]} globs
 */
function mentionedGlob(command, globs) {
  const nocase = process.platform === 'win32';
  const text = nocase ? command.replace(/\\/g, '/').toLowerCase() : command.replace(/\\/g, '/');
  if (text.includes('.boundaries')) return '.boundaries/**';
  for (const glob of globs) {
    const index = glob.search(/[*?]/);
    const prefix = index === -1 ? glob : glob.slice(0, index);
    if (prefix.length >= 3 && text.includes(nocase ? prefix.toLowerCase() : prefix)) return glob;
  }
  return null;
}

/**
 * @param {'ask' | 'deny'} decision
 * @param {string} reason
 */
function result(decision, reason) {
  return { decision, reason };
}

/**
 * Decides whether a tool call needs confirmation.
 * @param {{ toolName: string, toolInput: Record<string, unknown>, cwd: string }} call
 * @returns {{ decision: 'ask' | 'deny', reason: string } | null}
 */
export function decide({ toolName, toolInput, cwd }) {
  const suffix = 'Changing it needs a decision record and human approval (see .boundaries/).';
  if (FILE_TOOLS.has(toolName)) {
    const target = toolInput.file_path ?? toolInput.notebook_path;
    if (typeof target !== 'string' || target === '') return null;
    const abs = path.resolve(cwd, target);
    const root = findRoot(path.dirname(abs));
    if (!root) return null;
    const rel = path.relative(root, abs).split(path.sep).join('/');
    if (rel.startsWith('../') || rel === '..' || path.isAbsolute(rel)) return null;
    const index = loadIndex(root);
    if (index.corrupt) return result('ask', `${INDEX_FILE} is unreadable, so every edit asks. Run boundaries generate.`);
    const nocase = process.platform === 'win32';
    const hit = index.globs.find((glob) => matchGlob(glob, rel, { nocase }));
    return hit ? result(index.decision, `${rel} is protected by agent-terminus (${hit}). ${suffix}`) : null;
  }
  if (SHELL_TOOLS.has(toolName)) {
    const command = toolInput.command;
    if (typeof command !== 'string' || command === '') return null;
    const root = findRoot(cwd);
    if (!root) return null;
    const index = loadIndex(root);
    const hit = mentionedGlob(command, index.globs);
    if (!hit && !index.corrupt) return null;
    if (segmentsOf(command).every(isReadOnlySegment)) return null;
    if (index.corrupt) return result('ask', `${INDEX_FILE} is unreadable, so commands ask. Run boundaries generate.`);
    return result(index.decision, `This command may change a protected path (${hit}). ${suffix}`);
  }
  return null;
}

/** Reads a PreToolUse event from stdin and prints the decision, if any. */
export function main() {
  let output = null;
  try {
    const event = JSON.parse(readFileSync(0, 'utf8'));
    const verdict = decide({
      toolName: String(event.tool_name ?? ''),
      toolInput: event.tool_input && typeof event.tool_input === 'object' ? event.tool_input : {},
      cwd: typeof event.cwd === 'string' && event.cwd ? event.cwd : process.cwd(),
    });
    if (verdict) output = verdict;
  } catch (error) {
    output = result('ask', `protect-boundaries hook failed (${error instanceof Error ? error.message : String(error)}); asking to be safe.`);
  }
  if (output) {
    process.stdout.write(
      `${JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: output.decision,
          permissionDecisionReason: output.reason,
        },
      })}\n`,
    );
  }
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) main();
