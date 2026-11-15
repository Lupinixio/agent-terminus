import { parse } from 'smol-toml';

const settings = parse('host = "127.0.0.1"\nport = 8080\n');

export function bindHost() {
  return String(settings.host);
}
