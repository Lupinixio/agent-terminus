// `.boundaries/kit.toml`: optional project configuration (not limits).

/** @typedef {import('./types.js').KitConfig} KitConfig */

/** @returns {KitConfig} */
export function defaultKit() {
  return {
    file: null,
    decisions: [],
    rulesLint: { files: null, allow: [] },
    protected: [],
    hookDecision: 'ask',
    pythonSysPath: [],
    nodeTsconfig: null,
  };
}

/**
 * Builds a KitConfig from an already validated raw table.
 * @param {Record<string, any>} raw
 * @param {string} file
 * @returns {KitConfig}
 */
export function kitFromRaw(raw, file) {
  return {
    file,
    decisions: raw.decisions ?? [],
    rulesLint: { files: raw.rules_lint?.files ?? null, allow: raw.rules_lint?.allow ?? [] },
    protected: raw.protected?.paths ?? [],
    hookDecision: raw.hook?.decision ?? 'ask',
    pythonSysPath: raw.python?.sys_path ?? [],
    nodeTsconfig: raw.node?.tsconfig ?? null,
  };
}
