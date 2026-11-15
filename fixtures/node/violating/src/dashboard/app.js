// The same dashboard with one violation of every kind the manifest limits.
import { readFileSync } from 'node:fs';
import { exec } from 'node:child_process';
import Ajv from 'ajv';
import { parse } from 'smol-toml';
import { now } from '../clock.js';
import { readStatus, requestPause } from '../core/contract.js';
import { flattenAll } from '../core/engine.js';

/** @typedef {{ method: string, path: string, headers: Record<string, string> }} Request */
/** @typedef {{ status: number, body: string }} Response */

/** @type {Record<string, (req: Request) => Response>} */
export const routes = {
  'GET /': () => ({ status: 200, body: '<h1>Dashboard</h1>' }),
  'GET /api/status': () => ({ status: 200, body: JSON.stringify({ ...readStatus(), at: now() }) }),
  'POST /api/pause': () => {
    requestPause();
    return { status: 202, body: 'paused' };
  },
  'POST /api/flatten': () => ({ status: 200, body: flattenAll() }),
};

/** @param {Request} req */
export function handle(req) {
  const route = routes[`${req.method} ${req.path}`];
  return route ? route(req) : { status: 404, body: 'not found' };
}

export function report() {
  exec('uptime');
  return fetch('https://example.invalid/report', { method: 'POST', body: readFileSync('state.json', 'utf8') });
}

export const validator = new Ajv();
export const defaults = parse('x = 1');
