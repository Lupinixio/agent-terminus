// Command-line interface. The only place that picks exit codes.
import path from 'node:path';
import { parseArgs } from 'node:util';
import { check } from './check.js';
import { generateFiles } from './generate.js';
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
