// Secret sentinels and the encodings searched for when looking for leaks.
// Same list as the Python adapter: raw, each 16-character half, URL-quoted,
// base64 and urlsafe base64 (at every byte alignment), JSON-escaped, repr.
import { randomBytes } from 'node:crypto';

/** A fresh sentinel: `bk_` + 32 hex characters. */
export function makeSentinel() {
  return `bk_${randomBytes(16).toString('hex')}`;
}

/**
 * The part of base64(prefix + text + suffix) that depends only on `text`,
 * for a prefix of `offset` bytes (0, 1 or 2).
 * @param {string} text
 * @param {number} offset
 */
function base64Core(text, offset) {
  const bytes = Buffer.concat([Buffer.alloc(offset), Buffer.from(text, 'utf8')]);
  const encoded = bytes.toString('base64');
  const startGroup = Math.ceil(offset / 3);
  const endGroup = Math.floor(bytes.length / 3);
  return encoded.slice(startGroup * 4, endGroup * 4);
}

/**
 * Every searched form of a sentinel, as [label, text] pairs (deduplicated).
 * @param {string} sentinel
 * @returns {[string, string][]}
 */
export function sentinelForms(sentinel) {
  const hex = sentinel.slice(3);
  /** @type {[string, string][]} */
  const forms = [
    ['raw', sentinel],
    ['first half', hex.slice(0, 16)],
    ['second half', hex.slice(16)],
    ['url-quoted', encodeURIComponent(sentinel)],
    ['json', JSON.stringify(sentinel).slice(1, -1)],
    ['repr', `'${sentinel}'`],
  ];
  for (const offset of [0, 1, 2]) {
    const b64 = base64Core(sentinel, offset);
    forms.push([`base64`, b64]);
    forms.push([`urlsafe base64`, b64.replace(/\+/g, '-').replace(/\//g, '_')]);
  }
  const seen = new Set();
  return forms.filter(([, text]) => {
    if (!text || seen.has(text)) return false;
    seen.add(text);
    return true;
  });
}

/**
 * Leaks of any sentinel in any text.
 * @param {{ source: string, text: string }[]} texts
 * @param {Record<string, string>} sentinels name -> sentinel
 * @returns {{ name: string, source: string, form: string }[]}
 */
export function findLeaks(texts, sentinels) {
  /** @type {{ name: string, source: string, form: string }[]} */
  const leaks = [];
  for (const [name, sentinel] of Object.entries(sentinels)) {
    const forms = sentinelForms(sentinel);
    for (const { source, text } of texts) {
      const hit = forms.find(([, form]) => text.includes(form));
      if (hit) leaks.push({ name, source, form: hit[0] });
    }
  }
  return leaks;
}
