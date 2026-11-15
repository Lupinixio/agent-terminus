import { parse } from 'smol-toml';

const settings = parse('host = "0.0.0.0"\nport = 8080\n');

export function bindHost() {
  return String(settings.host);
}
