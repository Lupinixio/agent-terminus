// Providers for .boundaries/dashboard.toml. Protected: they must read the real
// route table and settings, never a hand-written list.
import { routes } from './app.js';
import { bindHost } from './settings.js';

export function httpRoutes(): string[] {
  return Object.keys(routes);
}

export function bindHosts(): string[] {
  return [bindHost()];
}
