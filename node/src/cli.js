// Command-line interface. The only place that picks exit codes.
import path from 'node:path';
import { parseArgs } from 'node:util';
import { check } from './check.js';
import { codeownersBlock, DEFAULT_OWNER } from './codeowners.js';
import { diffBoundaries } from './diff.js';
import { generateFiles } from './generate.js';
import { init } from './init.js';
import { formatFinding, lintRules } from './lint-rules.js';
import { ADAPTER, loadProject } from './manifest.js';
import { EXIT, emptyReport, exitCode, renderJson, renderText } from './report.js';
import { SCHEMA_VERSIONS, SUPPORTED_KEYS } from './support.js';
import { VERSION } from './version.js';

const USAGE = `boundaries ${VERSION} (node adapter)

Usage:
  boundaries check      [--root .] [--component NAME]... [--format text|json]
  boundaries validate   [--root .] [--format text|json]
  boundaries generate   [--root .]
  boundaries keys       --json
  boundaries lint-rules [--root .] [--files GLOB]...
  boundaries diff       --base REF [--root .]
  boundaries codeowners [--root .] [--owner @team]
  boundaries init       [--root .] [--claude] [--agents-md] [--git-hook] [--with-ci]
                        [--owner @team] [--update] [--dry-run]

Exit codes: 0 pass, 1 violations, 2 usage, 3 config, 4 stale generated files, 70 internal error.
`;

/**
 * @typedef {{ out: (text: string) => void, err: (text: string) => void, cwd: string }} Io
 * @typedef {(args: string[], io: Io) => Promise<number>} Command
 */

class UsageError extends Error {}

/**
 * @template {import('node:util').ParseArgsConfig['options']} T
 * @param {string[]} args
 * @param {T} options
 */
function parse(args, options) {
  try {
    return parseArgs({ args, options, strict: true, allowPositionals: false });
  } catch (error) {
    throw new UsageError(error instanceof Error ? error.message : String(error));
  }
}

/** @param {unknown} format */
function checkFormat(format) {
  if (format !== undefined && format !== 'text' && format !== 'json') throw new UsageError(`unknown --format ${String(format)}`);
  return format === 'json' ? 'json' : 'text';
}

/** @type {Record<string, Command>} */
const COMMANDS = {
  async check(args, io) {
    const { values } = parse(args, {
      root: { type: 'string', default: '.' },
      component: { type: 'string', multiple: true },
      format: { type: 'string' },
    });
    const format = checkFormat(values.format);
    const root = path.resolve(io.cwd, values.root);
    const { report, checked, project } = await check({ root, components: values.component });
    const known = new Set(project.manifests.map((m) => m.component.name));
    const unknown = (values.component ?? []).filter((c) => !known.has(c));
    if (unknown.length > 0 && report.errors.length === 0) throw new UsageError(`unknown component(s): ${unknown.join(', ')}`);
    io.out(format === 'json' ? renderJson(report) : renderText(report, { checked }));
    return exitCode(report);
  },

  async validate(args, io) {
    const { values } = parse(args, { root: { type: 'string', default: '.' }, format: { type: 'string' } });
    const format = checkFormat(values.format);
    const project = await loadProject(path.resolve(io.cwd, values.root));
    const report = emptyReport();
    report.errors.push(...project.problems);
    for (const m of project.manifests) {
      if (m.component.language !== ADAPTER) {
        report.skipped.push({ component: m.component.name, reason: `language ${m.component.language} is checked by its own adapter` });
      }
    }
    io.out(format === 'json' ? renderJson(report) : renderText(report));
    return exitCode(report);
  },

  async generate(args, io) {
    const { values } = parse(args, { root: { type: 'string', default: '.' } });
    const project = await loadProject(path.resolve(io.cwd, values.root));
    if (project.problems.length > 0) {
      const report = emptyReport();
      report.errors.push(...project.problems);
      io.err(renderText(report));
      return EXIT.CONFIG;
    }
    for (const { file, stale } of generateFiles({ project, write: true })) {
      io.out(`${stale ? 'wrote' : 'unchanged'}: ${file}\n`);
    }
    return EXIT.OK;
  },

  async keys(args, io) {
    const { values } = parse(args, { json: { type: 'boolean', default: false } });
    const payload = { adapter: ADAPTER, schema_versions: [...SCHEMA_VERSIONS], supported_keys: [...SUPPORTED_KEYS] };
    io.out(values.json ? `${JSON.stringify(payload, null, 2)}\n` : `${SUPPORTED_KEYS.join('\n')}\n`);
    return EXIT.OK;
  },

  async 'lint-rules'(args, io) {
    const { values } = parse(args, { root: { type: 'string', default: '.' }, files: { type: 'string', multiple: true } });
    const project = await loadProject(path.resolve(io.cwd, values.root));
    if (project.problems.length > 0) {
      const report = emptyReport();
      report.errors.push(...project.problems);
      io.err(renderText(report));
      return EXIT.CONFIG;
    }
    const findings = lintRules(project, { files: values.files ?? null });
    for (const f of findings) io.out(`${formatFinding(f)}\n`);
    io.out(
      findings.length === 0
        ? 'lint-rules: ok\n'
        : `lint-rules: ${findings.length} manifest-owned identifier(s) restated in rules files; point to the manifest instead, or list them in kit.toml rules_lint.allow\n`,
    );
    return findings.length === 0 ? EXIT.OK : EXIT.VIOLATIONS;
  },

  async diff(args, io) {
    const { values } = parse(args, { root: { type: 'string', default: '.' }, base: { type: 'string' } });
    if (!values.base) throw new UsageError('diff needs --base <ref>');
    const result = diffBoundaries({ root: path.resolve(io.cwd, values.root), base: values.base });
    (result.code === EXIT.USAGE ? io.err : io.out)(`${result.lines.join('\n')}\n`);
    return result.code;
  },

  async codeowners(args, io) {
    const { values } = parse(args, { root: { type: 'string', default: '.' }, owner: { type: 'string' } });
    const project = await loadProject(path.resolve(io.cwd, values.root));
    if (project.problems.length > 0) {
      const report = emptyReport();
      report.errors.push(...project.problems);
      io.err(renderText(report));
      return EXIT.CONFIG;
    }
    if (values.owner !== undefined && !/^@\S+$|^\S+@\S+$/.test(values.owner)) throw new UsageError('--owner must be @user, @org/team or an email');
    io.out(codeownersBlock(project, values.owner ?? DEFAULT_OWNER));
    return EXIT.OK;
  },

  async init(args, io) {
    const { values } = parse(args, {
      root: { type: 'string', default: '.' },
      claude: { type: 'boolean', default: false },
      'agents-md': { type: 'boolean', default: false },
      'git-hook': { type: 'boolean', default: false },
      'with-ci': { type: 'boolean', default: false },
      owner: { type: 'string' },
      update: { type: 'boolean', default: false },
      'dry-run': { type: 'boolean', default: false },
    });
    if (values.owner !== undefined && !/^@\S+$|^\S+@\S+$/.test(values.owner)) throw new UsageError('--owner must be @user, @org/team or an email');
    const result = await init({
      root: path.resolve(io.cwd, values.root),
      claude: values.claude,
      agentsMd: values['agents-md'],
      gitHook: values['git-hook'],
      withCi: values['with-ci'],
      owner: values.owner,
      update: values.update,
      dryRun: values['dry-run'],
    });
    io.out(`${result.lines.join('\n')}\n`);
    return result.code;
  },
};

/**
 * Runs the CLI and returns the exit code.
 * @param {string[]} argv arguments after the program name
 * @param {Partial<Io>} [ioOverrides]
 * @returns {Promise<number>}
 */
export async function main(argv, ioOverrides = {}) {
  /** @type {Io} */
  const io = {
    out: (text) => process.stdout.write(text),
    err: (text) => process.stderr.write(text),
    cwd: process.cwd(),
    ...ioOverrides,
  };
  const [name, ...rest] = argv;
  if (name === undefined || name === '--help' || name === '-h' || name === 'help') {
    io.out(USAGE);
    return name === undefined ? EXIT.USAGE : EXIT.OK;
  }
  if (name === '--version' || name === '-v') {
    io.out(`${VERSION}\n`);
    return EXIT.OK;
  }
  const command = Object.hasOwn(COMMANDS, name) ? COMMANDS[name] : undefined;
  if (!command) {
    io.err(`unknown command "${name}"\n\n${USAGE}`);
    return EXIT.USAGE;
  }
  try {
    return await command(rest, io);
  } catch (error) {
    if (error instanceof UsageError) {
      io.err(`${error.message}\n\n${USAGE}`);
      return EXIT.USAGE;
    }
    io.err(`internal error: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
    return EXIT.INTERNAL;
  }
}

export { UsageError };
