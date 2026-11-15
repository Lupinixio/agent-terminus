// [calls]: forbidden calls, found with @babel/parser and a small visitor.
//
// Call names are resolved through import bindings: `import { exec as x } from
// 'node:child_process'; x()` is `child_process.exec`; a default or namespace
// import binds the module name. Bare names count only when no import binds them.
// `new X()` counts as a call.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parse } from '@babel/parser';
import { ConfigError } from '../errors.js';
import { walkFiles } from '../files.js';
import { matchGlob } from '../glob.js';

/**
 * @typedef {import('../types.js').Project} Project
 * @typedef {import('../types.js').Manifest} Manifest
 * @typedef {import('../types.js').Violation} Violation
 * @typedef {import('../types.js').CallPattern} CallPattern
 * @typedef {{ type: string, [key: string]: any }} AstNode
 * @typedef {{ segments: string[], known: boolean, line: number }} FoundCall
 */

export const SOURCE_EXTENSIONS = Object.freeze(['.js', '.mjs', '.cjs', '.jsx', '.ts', '.mts', '.cts', '.tsx']);
const GLOBAL_OBJECTS = new Set(['globalThis', 'window', 'global', 'self']);

/** @param {string} segment */
function segmentRegExp(segment) {
  return new RegExp(`^${segment.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`);
}

/**
 * Whether a resolved call matches a pattern (pure; same semantics in Python).
 * @param {string} pattern
 * @param {string[]} segments resolved dotted name
 * @param {boolean} known whether the first segment is a real name (not an expression)
 */
export function matchCall(pattern, segments, known) {
  if (pattern.startsWith('*.')) {
    const rest = pattern.slice(2).split('.');
    if (segments.length <= rest.length) return false;
    const tail = segments.slice(segments.length - rest.length);
    return rest.every((p, i) => segmentRegExp(p).test(tail[i]));
  }
  if (!known) return false;
  const parts = pattern.split('.');
  return parts.length === segments.length && parts.every((p, i) => segmentRegExp(p).test(segments[i]));
}

/** @param {string} source */
export function moduleName(source) {
  return source.replace(/^node:/, '').replace(/\//g, '.');
}

/** @param {string} file */
function parserOptions(file) {
  const ext = path.extname(file);
  /** @type {any[]} */
  const plugins = ext === '.tsx' ? ['typescript', 'jsx'] : ['.ts', '.mts', '.cts'].includes(ext) ? ['typescript'] : ['jsx'];
  /** @type {'module' | 'commonjs' | 'unambiguous'} */
  const sourceType = ext === '.mjs' || ext === '.mts' ? 'module' : ext === '.cjs' || ext === '.cts' ? 'commonjs' : 'unambiguous';
  return sourceType === 'unambiguous' ? { sourceType, plugins, allowReturnOutsideFunction: true } : { sourceType, plugins };
}

/** @param {unknown} v @returns {v is AstNode} */
function isNode(v) {
  return typeof v === 'object' && v !== null && typeof (/** @type {any} */ (v).type) === 'string';
}

/**
 * Visits every AST node depth-first.
 * @param {AstNode} node
 * @param {(node: AstNode) => void} visit
 */
function walk(node, visit) {
  visit(node);
  for (const key of Object.keys(node)) {
    if (key === 'loc' || key === 'leadingComments' || key === 'trailingComments' || key === 'innerComments' || key === 'extra') continue;
    const value = node[key];
    if (Array.isArray(value)) {
      for (const item of value) if (isNode(item)) walk(item, visit);
    } else if (isNode(value)) {
      walk(value, visit);
    }
  }
}

/** @param {AstNode | null | undefined} node @returns {string | null} */
function requireSource(node) {
  if (!node) return null;
  if (node.type === 'AwaitExpression') return requireSource(node.argument);
  const isRequire = node.type === 'CallExpression' && node.callee.type === 'Identifier' && node.callee.name === 'require';
  const isImport = node.type === 'CallExpression' && node.callee.type === 'Import';
  const isImportExpr = node.type === 'ImportExpression';
  if (isImportExpr && node.source?.type === 'StringLiteral') return node.source.value;
  if ((isRequire || isImport) && node.arguments.length === 1 && node.arguments[0].type === 'StringLiteral') return node.arguments[0].value;
  return null;
}

/** @param {AstNode} key */
function propertyName(key) {
  if (key.type === 'Identifier') return key.name;
  if (key.type === 'StringLiteral') return key.value;
  return null;
}

/**
 * Import bindings of a program: local name -> dotted target.
 * @param {AstNode} program
 */
export function collectBindings(program) {
  /** @type {Map<string, string>} */
  const bindings = new Map();
  walk(program, (node) => {
    if (node.type === 'ImportDeclaration') {
      const mod = moduleName(node.source.value);
      for (const s of node.specifiers) {
        if (s.type === 'ImportSpecifier') {
          const imported = propertyName(s.imported);
          bindings.set(s.local.name, imported === 'default' || imported === null ? mod : `${mod}.${imported}`);
        } else {
          bindings.set(s.local.name, mod);
        }
      }
    } else if (node.type === 'TSImportEqualsDeclaration' && node.moduleReference?.type === 'TSExternalModuleReference') {
      bindings.set(node.id.name, moduleName(node.moduleReference.expression.value));
    } else if (node.type === 'VariableDeclarator') {
      const source = requireSource(node.init);
      if (source === null) return;
      const mod = moduleName(source);
      if (node.id.type === 'Identifier') bindings.set(node.id.name, mod);
      else if (node.id.type === 'ObjectPattern') {
        for (const prop of node.id.properties) {
          if (prop.type !== 'ObjectProperty') continue;
          const key = propertyName(prop.key);
          const local = prop.value.type === 'AssignmentPattern' ? prop.value.left : prop.value;
          if (key && local.type === 'Identifier') bindings.set(local.name, key === 'default' ? mod : `${mod}.${key}`);
        }
      }
    }
  });
  return bindings;
}

/**
 * Resolves a callee to dotted segments.
 * @param {AstNode} node
 * @param {Map<string, string>} bindings
 * @returns {{ segments: string[], known: boolean }}
 */
function resolveCallee(node, bindings) {
  if (node.type === 'Identifier') {
    const bound = bindings.get(node.name);
    return { segments: (bound ?? node.name).split('.'), known: true };
  }
  if (node.type === 'TSNonNullExpression' || node.type === 'ParenthesizedExpression' || node.type === 'TSAsExpression') {
    return resolveCallee(node.expression, bindings);
  }
  const source = requireSource(node);
  if (source !== null) return { segments: moduleName(source).split('.'), known: true };
  if (node.type === 'MemberExpression' || node.type === 'OptionalMemberExpression') {
    const prop = node.computed ? (node.property.type === 'StringLiteral' ? node.property.value : null) : propertyName(node.property);
    const object = resolveCallee(node.object, bindings);
    if (prop === null) return { segments: [...object.segments, '<computed>'], known: false };
    if (object.known && object.segments.length === 1 && GLOBAL_OBJECTS.has(object.segments[0]) && !bindings.has(object.segments[0])) {
      return { segments: [prop], known: true };
    }
    return { segments: [...object.segments, prop], known: object.known };
  }
  return { segments: ['<expression>'], known: false };
}

/**
 * Parses a JS/TS source (throws on a syntax error).
 * @param {string} code
 * @param {string} file used to pick parser plugins
 * @returns {AstNode}
 */
export function parseSource(code, file) {
  return /** @type {AstNode} */ (/** @type {unknown} */ (parse(code, parserOptions(file))));
}

/**
 * Every call (and `new`) in a source text.
 * @param {string} code
 * @param {string} file used to pick parser plugins
 * @returns {FoundCall[]}
 */
export function findCalls(code, file) {
  const ast = parseSource(code, file);
  const bindings = collectBindings(ast.program);
  /** @type {FoundCall[]} */
  const calls = [];
  walk(ast.program, (node) => {
    if (node.type === 'CallExpression' || node.type === 'OptionalCallExpression' || node.type === 'NewExpression') {
      if (node.callee.type === 'Import' || node.callee.type === 'Super') return;
      const { segments, known } = resolveCallee(node.callee, bindings);
      calls.push({ segments, known, line: node.loc?.start.line ?? 0 });
    }
  });
  return calls;
}

/**
 * Source files of a component (project-relative), minus `exclude`.
 * @param {Project} project
 * @param {Manifest} manifest
 */
export function componentSources(project, manifest) {
  const nocase = process.platform === 'win32';
  return walkFiles(project.root, manifest.component.root).filter(
    (f) =>
      SOURCE_EXTENSIONS.includes(path.extname(f)) &&
      !f.endsWith('.d.ts') &&
      !manifest.component.exclude.some((g) => matchGlob(g, f, { nocase })),
  );
}

/**
 * @param {Project} project
 * @param {Manifest} manifest
 * @returns {Promise<Violation[]>}
 */
export async function checkCalls(project, manifest) {
  if (!manifest.calls) return [];
  /** @type {Violation[]} */
  const out = [];
  for (const file of componentSources(project, manifest)) {
    let calls;
    try {
      calls = findCalls(readFileSync(path.join(project.root, file), 'utf8'), file);
    } catch (error) {
      throw new ConfigError(file, 'calls', `cannot parse ${file}: ${error instanceof Error ? error.message : String(error)}`);
    }
    for (const call of calls) {
      const hit = manifest.calls.find((p) => matchCall(p.pattern, call.segments, call.known));
      if (!hit) continue;
      const name = call.segments.join('.');
      out.push({
        component: manifest.component.name,
        check: 'calls',
        key: 'calls.forbidden',
        location: `${file}:${call.line}`,
        message: `call to ${name} matches forbidden pattern ${hit.pattern}${hit.reason ? ` (${hit.reason})` : ''}`,
      });
    }
  }
  return out;
}
