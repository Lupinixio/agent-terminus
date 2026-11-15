// The only module of the Node adapter that touches the process environment.
// The secrets probe needs it: it plants sentinel values under the declared
// secret names, runs the probe, and restores the previous values.

/**
 * Sets each name to its value and returns a function that restores the
 * previous state (unset names are deleted again).
 * @param {Record<string, string>} values
 * @returns {() => void}
 */
export function plantEnv(values) {
  /** @type {Map<string, string | undefined>} */
  const previous = new Map();
  for (const [name, value] of Object.entries(values)) {
    previous.set(name, process.env[name]);
    process.env[name] = value;
  }
  return () => {
    for (const [name, value] of previous) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  };
}
