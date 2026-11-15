// A tiny operator dashboard: a route table, no web framework.
import { now } from '../clock.js';
import { readStatus, requestPause } from '../core/contract.js';

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
};

/** @param {Request} req */
export function handle(req) {
  const route = routes[`${req.method} ${req.path}`];
  return route ? route(req) : { status: 404, body: 'not found' };
}
