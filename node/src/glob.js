// Pure glob matching shared by every adapter (cases in schema/fixtures/globs.json).
// Supported syntax: `*` (within a segment), `?` (one character), `**` (any number
// of whole segments). Paths use forward slashes and are relative to the project root.

/** @param {string} text */
function escapeRegExp(text) {
  return text.replace(/[.+^${}()|[\]\\]/g, '\\$&');
}

/** @param {string} segment */
function segmentSource(segment) {
  let out = '';
  for (const ch of segment) {
    if (ch === '*') out += '[^/]*';
    else if (ch === '?') out += '[^/]';
    else out += escapeRegExp(ch);
  }
  return out;
}

/**
 * Regular-expression source (without anchors) for a glob.
 * `a/**` matches everything below `a`, `** /b` (no space) matches `b` at any depth.
 * @param {string} glob
 * @returns {string}
 */
export function globSource(glob) {
  const segments = glob.replace(/\\/g, '/').split('/');
  let out = '';
  for (let i = 0; i < segments.length; i += 1) {
    const segment = segments[i];
    const last = i === segments.length - 1;
    if (segment === '**') {
      if (segments.length === 1) out += '.*';
      else if (i === 0) out += '(?:.*/)?';
      else if (last) out += '/.+';
      else out += '/(?:.*/)?';
    } else {
      if (i > 0 && segments[i - 1] !== '**') out += '/';
      out += segmentSource(segment);
    }
  }
  return out;
}

/**
 * @param {string} glob
 * @param {{ nocase?: boolean }} [options]
 * @returns {RegExp}
 */
export function globToRegExp(glob, options = {}) {
  return new RegExp(`^${globSource(glob)}$`, options.nocase ? 'i' : '');
}

/**
 * Whether a project-relative path matches a glob.
 * @param {string} glob
 * @param {string} relPath
 * @param {{ nocase?: boolean }} [options]
 */
export function matchGlob(glob, relPath, options = {}) {
  return globToRegExp(glob, options).test(relPath.replace(/\\/g, '/'));
}

/** @param {string} text */
export function hasGlobChars(text) {
  return /[*?]/.test(text);
}

/**
 * The literal text before the first glob character.
 * @param {string} glob
 */
export function literalPrefix(glob) {
  const index = glob.search(/[*?]/);
  return index === -1 ? glob : glob.slice(0, index);
}
