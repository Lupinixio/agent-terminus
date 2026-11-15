// `boundaries init`: sets a project up. Idempotent; never overwrites a file
// that differs unless --update; refusals print the snippet instead.
// Prints (never runs) git config and GitHub settings steps.
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { codeownersBlock, BEGIN as CO_BEGIN, DEFAULT_OWNER } from './codeowners.js';
import { generateFiles } from './generate.js';
import { loadProject } from './manifest.js';
import { VERSION } from './version.js';

export const KIT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const HOOK_COMMAND = 'node "$CLAUDE_PROJECT_DIR/.claude/hooks/protect-boundaries.mjs"';
export const HOOK_MATCHER = 'Edit|Write|MultiEdit|NotebookEdit|Bash|PowerShell';
const AGENTS_START = '<!-- agent-terminus:rules:start -->';
const AGENTS_END = '<!-- agent-terminus:rules:end -->';
const PRE_COMMIT_BEGIN = '# BEGIN agent-terminus commands';
const PRE_COMMIT_END = '# END agent-terminus commands';

/**
 * @typedef {{
 *   root: string, claude?: boolean, agentsMd?: boolean, gitHook?: boolean, withCi?: boolean,
 *   owner?: string, update?: boolean, dryRun?: boolean
 * }} InitOptions
 */

const KIT_TOML = `# agent-terminus project configuration. Component limits live in
# .boundaries/<component>.toml (see component.toml.example).
schema_version = 1

# Decision records for kit-level changes and for deleting a manifest.
decisions = []

[protected]
# Extra paths that need confirmation and code-owner review, for example
# boundary tests: paths = ["tests/boundaries/**"]
paths = []
`;

const COMPONENT_EXAMPLE = `# Example component manifest. Copy to .boundaries/<name>.toml (the file name
# must equal component.name), keep the sections you need, and link a decision
# record. Reference: docs/manifest.md in agent-terminus.
schema_version = 1

[component]
name = "web"
language = "python"            # or "node"
root = "src/app/web"
package = "app.web"            # Python only
principle = "One sentence: what this component is for and what it must not do."
decisions = ["docs/decisions/0001-web-boundary.md"]

[imports]                      # all three lists are required; "any" disables one
internal = ["app.core.contract"]
external = ["starlette"]
builtin = ["json", "logging"]

[calls]
forbidden = ["open", "subprocess.*", { pattern = "os.system", reason = "no shell" }]

[[entrypoints]]
name = "http"
provider = "app.web.boundary:http_routes"   # Node: "./src/web/boundary.js#httpRoutes"
exact = ["GET /", "GET /api/status"]

[runtime.bind]
hosts = ["127.0.0.1"]
provider = "app.web.boundary:bind_hosts"

[runtime.secrets]
names = ["APP_API_TOKEN"]
probe = "app.web.boundary:secret_probe"

[protected]
paths = ["src/app/web/boundary.py"]         # providers and probes must be protected
`;

/** @param {string} rel */
function kitFile(rel) {
  return readFileSync(path.join(KIT_ROOT, rel), 'utf8');
}

/** @param {string} text */
function indent(text) {
  return text
    .trimEnd()
    .split('\n')
    .map((l) => `    ${l}`)
    .join('\n');
}

/**
 * The workflow template without the jobs for languages the project lacks.
 * @param {{ python: boolean, node: boolean }} langs
 */
export function workflowFor(langs) {
  const lines = kitFile('templates/github/boundaries.yml').split('\n');
  const starts = lines.flatMap((l, i) => (/^ {2}# Delete this job/.test(l) ? [i] : []));
  /** @type {[number, number, string][]} */
  const blocks = starts.map((s, k) => [s, k + 1 < starts.length ? starts[k + 1] : lines.length, '']);
  for (const block of blocks) {
    const jobLine = lines.slice(block[0], block[1]).find((l) => /^ {2}[a-z]+:$/.test(l)) ?? '';
    block[2] = jobLine.trim().replace(':', '');
  }
  const drop = new Set();
  for (const [s, e, job] of blocks) {
    if ((job === 'python' && !langs.python) || (job === 'node' && !langs.node)) for (let i = s; i < e; i += 1) drop.add(i);
  }
  return `${lines
    .filter((_, i) => !drop.has(i))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trimEnd()}\n`;
}

/**
 * Pre-commit hook text for the detected languages.
 * @param {{ python: boolean, node: boolean, uvLock: boolean }} langs
 */
export function preCommitFor(langs) {
  /** @type {string[]} */
  const commands = [];
  if (langs.python) commands.push(langs.uvLock ? 'uv run boundaries check' : 'python -m agent_terminus check');
  if (langs.node) commands.push('npx --no-install boundaries check', 'npx --no-install boundaries lint-rules');
  else commands.push('# npx --yes --package=github:Lupinixio/agent-terminus#v' + VERSION + ' boundaries lint-rules');
  const template = kitFile('hooks/pre-commit.sh');
  return template.replace(`${PRE_COMMIT_BEGIN}\n${PRE_COMMIT_END}`, [PRE_COMMIT_BEGIN, ...commands, PRE_COMMIT_END].join('\n'));
}

/**
 * Merges the hook entry into a Claude Code settings object (pure).
 * @param {Record<string, any>} settings
 * @returns {{ settings: Record<string, any>, changed: boolean }}
 */
export function mergeSettings(settings) {
  const next = structuredClone(settings);
  next.hooks ??= {};
  next.hooks.PreToolUse ??= [];
  const present = next.hooks.PreToolUse.some((/** @type {any} */ e) =>
    (e?.hooks ?? []).some((/** @type {any} */ h) => h?.command === HOOK_COMMAND),
  );
  if (present) return { settings, changed: false };
  next.hooks.PreToolUse.push({ matcher: HOOK_MATCHER, hooks: [{ type: 'command', command: HOOK_COMMAND }] });
  return { settings: next, changed: true };
}

/**
 * @param {InitOptions} options
 * @returns {Promise<{ code: number, lines: string[] }>}
 */
export async function init(options) {
  const root = path.resolve(options.root);
  /** @type {string[]} */
  const lines = [];
  const dry = Boolean(options.dryRun);
  const say = (/** @type {string} */ line) => lines.push(line);

  /**
   * Writes a file unless it exists with other content (then only with --update).
   * @param {string} rel
   * @param {string} content
   * @param {{ update?: boolean, executable?: boolean }} [opts]
   */
  const place = (rel, content, opts = {}) => {
    const abs = path.join(root, rel);
    const current = existsSync(abs) ? readFileSync(abs, 'utf8').replace(/\r\n/g, '\n') : null;
    if (current === content) return say(`unchanged ${rel}`);
    if (current !== null && !opts.update) {
      say(`kept ${rel} (it differs; rerun with --update to replace it). Wanted content:`);
      return say(indent(content));
    }
    if (!dry) {
      mkdirSync(path.dirname(abs), { recursive: true });
      writeFileSync(abs, content);
      if (opts.executable) chmodSync(abs, 0o755);
    }
    say(`${dry ? 'would write' : current === null ? 'created' : 'updated'} ${rel}`);
  };

  const langs = {
    python: existsSync(path.join(root, 'pyproject.toml')),
    node: existsSync(path.join(root, 'package.json')),
    uvLock: existsSync(path.join(root, 'uv.lock')),
  };

  place('.boundaries/kit.toml', KIT_TOML);
  const rules = `<!-- agent-terminus ${VERSION}: copy of rules/boundaries.md. Refresh with: boundaries init --update -->\n${kitFile('rules/boundaries.md')}`;
  place('.boundaries/rules.md', rules, { update: options.update });
  place('.boundaries/component.toml.example', COMPONENT_EXAMPLE, { update: options.update });

  if (options.claude) {
    place('.claude/hooks/protect-boundaries.mjs', kitFile('hooks/protect-boundaries.mjs'), { update: options.update });
    const settingsRel = '.claude/settings.json';
    const settingsAbs = path.join(root, settingsRel);
    /** @type {Record<string, any> | null} */
    let settings = {};
    if (existsSync(settingsAbs)) {
      try {
        settings = JSON.parse(readFileSync(settingsAbs, 'utf8'));
      } catch {
        settings = null;
      }
    }
    if (settings === null || typeof settings !== 'object' || Array.isArray(settings)) {
      say(`kept ${settingsRel} (not valid JSON). Add this entry to hooks.PreToolUse by hand:`);
      say(indent(JSON.stringify(mergeSettings({}).settings.hooks.PreToolUse[0], null, 2)));
    } else {
      const merged = mergeSettings(settings);
      if (!merged.changed) say(`unchanged ${settingsRel} (hook already registered)`);
      else {
        if (!dry) {
          mkdirSync(path.dirname(settingsAbs), { recursive: true });
          writeFileSync(settingsAbs, `${JSON.stringify(merged.settings, null, 2)}\n`);
        }
        say(`${dry ? 'would register' : 'registered'} the hook in ${settingsRel}`);
      }
    }
    const claudeAbs = path.join(root, 'CLAUDE.md');
    const claude = existsSync(claudeAbs) ? readFileSync(claudeAbs, 'utf8') : null;
    if (claude !== null && /^@\.boundaries\/rules\.md\s*$/m.test(claude)) say('unchanged CLAUDE.md (already imports .boundaries/rules.md)');
    else {
      const addition = '## Boundaries\n@.boundaries/rules.md\n';
      const text = claude === null ? addition : `${claude.replace(/\s*$/, '')}\n\n${addition}`;
      if (!dry) writeFileSync(claudeAbs, text);
      say(`${dry ? 'would append' : 'appended'} the rules import to CLAUDE.md`);
    }
  }

  if (options.agentsMd) {
    const block = `${AGENTS_START}\n${kitFile('rules/boundaries.md').trimEnd()}\n${AGENTS_END}`;
    const abs = path.join(root, 'AGENTS.md');
    const current = existsSync(abs) ? readFileSync(abs, 'utf8').replace(/\r\n/g, '\n') : null;
    const start = current?.indexOf(AGENTS_START) ?? -1;
    const end = current?.indexOf(AGENTS_END) ?? -1;
    if (current !== null && start !== -1 && end > start) {
      const existing = current.slice(start, end + AGENTS_END.length);
      if (existing === block) say('unchanged AGENTS.md');
      else if (!options.update) say('kept AGENTS.md (the rules block differs; rerun with --update to replace it)');
      else {
        if (!dry) writeFileSync(abs, current.replace(existing, block));
        say(`${dry ? 'would update' : 'updated'} the rules block in AGENTS.md`);
      }
    } else {
      const text = current === null ? `${block}\n` : `${current.replace(/\s*$/, '')}\n\n${block}\n`;
      if (!dry) writeFileSync(abs, text);
      say(`${dry ? 'would add' : 'added'} the rules block to AGENTS.md`);
    }
  }

  if (options.gitHook) {
    place('.githooks/pre-commit', preCommitFor(langs), { update: options.update, executable: true });
    say('enable the git hook once per clone with: git config core.hooksPath .githooks');
  }

  const owner = options.owner ?? DEFAULT_OWNER;
  if (options.withCi) {
    place('.github/workflows/boundaries.yml', workflowFor({ python: langs.python, node: langs.node || !langs.python }), { update: options.update });
  }

  // Generated files: written now so the hook and `check` work immediately.
  const project = await loadProject(root);
  if (project.problems.length > 0) {
    say('generated files not written: the project has config errors (run boundaries validate)');
  } else if (!dry) {
    for (const { file, stale } of generateFiles({ project, write: true })) if (stale) say(`generated ${file}`);
  }

  const block = codeownersBlock(project, owner);
  if (options.withCi) {
    const rel = '.github/CODEOWNERS';
    const abs = path.join(root, rel);
    const current = existsSync(abs) ? readFileSync(abs, 'utf8') : null;
    if (current !== null && current.includes(CO_BEGIN)) say(`unchanged ${rel} (already has an agent-terminus block; refresh it with boundaries codeowners)`);
    else {
      if (!dry) {
        mkdirSync(path.dirname(abs), { recursive: true });
        writeFileSync(abs, current === null ? block : `${current.replace(/\s*$/, '')}\n\n${block}`);
      }
      say(`${dry ? 'would append' : 'appended'} the agent-terminus block to ${rel}`);
    }
  }
  if (!options.owner && options.withCi) {
    say(`WARNING: CODEOWNERS uses the placeholder owner ${DEFAULT_OWNER}. Replace it with a real team or user that has write access, or rerun with --owner.`);
  }

  say('');
  say('Next steps');
  if (options.withCi) {
    say('1. Review .github/CODEOWNERS and .github/workflows/boundaries.yml.');
    say('2. On GitHub, Settings > Rules > Rulesets (or Branches > branch protection) for the default branch:');
    say('   require a pull request, require review from Code Owners, dismiss stale approvals,');
    say('   require the status checks "boundaries / python" and/or "boundaries / node" with up-to-date branches,');
    say('   block force pushes, and leave the bypass list empty. Details: docs/protecting-checks.md.');
    say('3. Write a manifest per component (see .boundaries/component.toml.example), then run boundaries generate and boundaries check.');
  } else {
    say('1. Write a manifest per component (see .boundaries/component.toml.example), then run boundaries generate and boundaries check.');
    say('2. No server-side check was set up, so every local check can be skipped. To add the required CI job,');
    say('   CODEOWNERS and branch protection, rerun with --with-ci (details: docs/protecting-checks.md).');
  }
  return { code: 0, lines };
}
