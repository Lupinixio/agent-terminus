// Shared JSDoc types for the Node adapter. No runtime code.

/**
 * @typedef {{ target: string, onlyFrom: string[] | null }} AllowEntry
 * @typedef {'any' | AllowEntry[]} AllowList
 * @typedef {{ internal: AllowList, external: AllowList, builtin: AllowList }} Imports
 * @typedef {{ pattern: string, reason: string | null }} CallPattern
 * @typedef {{ name: string, provider: string, exact: string[] }} EntrypointGroup
 * @typedef {{ hosts: string[], provider: string }} Bind
 * @typedef {{ names: string[], probe: string }} Secrets
 * @typedef {{
 *   name: string, language: 'python' | 'node', root: string, package: string | null,
 *   exclude: string[], principle: string, decisions: string[]
 * }} Component
 * @typedef {{
 *   file: string,
 *   raw: Record<string, unknown>,
 *   component: Component,
 *   imports: Imports | null,
 *   calls: CallPattern[] | null,
 *   entrypoints: EntrypointGroup[],
 *   bind: Bind | null,
 *   secrets: Secrets | null,
 *   protected: string[]
 * }} Manifest
 * @typedef {{
 *   file: string | null,
 *   decisions: string[],
 *   rulesLint: { files: string[] | null, allow: string[] },
 *   protected: string[],
 *   hookDecision: 'ask' | 'deny',
 *   pythonSysPath: string[],
 *   nodeTsconfig: string | null
 * }} KitConfig
 * @typedef {{ file: string, key: string, message: string }} Problem
 * @typedef {{ root: string, kit: KitConfig, manifests: Manifest[], problems: Problem[] }} Project
 * @typedef {'imports' | 'calls' | 'entrypoints' | 'runtime.bind' | 'runtime.secrets'
 *   | 'protected' | 'decisions' | 'generated' | 'codeowners'} CheckName
 * @typedef {{ component: string, check: CheckName, key: string, location: string | null, message: string }} Violation
 * @typedef {{ component: string, reason: string }} Skipped
 * @typedef {{
 *   schema_version: 1, adapter: 'node', results: Violation[], skipped: Skipped[],
 *   stale: string[], errors: Problem[]
 * }} Report
 */

export {};
